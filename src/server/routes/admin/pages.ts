import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import {PAGE_SLUG} from '../../../components/pages/policy';
import type {AdminPage, AdminPageRow} from '../../../lib/types/admin/content';
import type {PostBlock} from '../../../lib/types/content';
import {withDb} from '../../../platform/guards';
import {queueEntityTranslation} from '../../lib/contracts';
import {slugify} from '../../lib/format';
import {apiError} from '../../lib/http';
import {json} from '../../lib/validate';

/**
 * Admin: CMS pages (privacy, terms, shipping info…). WP-07 (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/pages.ts: VAREL `/api/admin/pages…` is `/site-api/manage/pages…` here.
 * Bodies use the journal PostBlock format.
 *
 *   GET    /site-api/manage/pages                      AdminPageRow[] (no body; ≤ 100, pages are created in code)
 *   POST   /site-api/manage/pages                      AdminPageInput → 201 AdminPage
 *   GET    /site-api/manage/pages/:id                  AdminPage (id, or a slug as VAREL accepted)
 *   PATCH  /site-api/manage/pages/:id                  Partial<AdminPageInput> → AdminPage
 *   DELETE /site-api/manage/pages/:id                  204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: content; MANAGE_AREAS in src/server/permissions.ts), then the activity log.
 */

/** Slugs a CMS page cannot take: `new` (VAREL) and `sitemap` (the public API's static `/pages/sitemap`). */
const RESERVED = new Set(['new', 'sitemap']);

const LIST_LIMIT = 100;

// ─── Block schema (VAREL admin/posts.ts `text`, `photoInput`, `block`, `seoText`) ─────────────

const text = (label: string, max: number) =>
  z.string({error: `Enter ${label}`}).trim().min(1, `Enter ${label}`).max(max, `Keep ${label} under ${max} characters`);

/** An image source: an https URL, an uploaded platform file, or one of the site's own images. */
export const isImageSrc = (s: string) =>
  /^https:\/\/\S+$/i.test(s) || s.startsWith('/__platform/files/') || s.startsWith('/site-api/media/') || /^\/images\/\S+$/.test(s);

const photoInput = z.object({
  src: z
    .string({error: 'Add an image'})
    .trim()
    .min(1, 'Add an image')
    .max(2000, 'Keep the image address under 2000 characters')
    .refine(isImageSrc, 'Use an https URL or an uploaded image'),
  credit: z.string().trim().max(200).nullish(),
  creditHref: z.string().trim().max(2000).nullish(),
});

const toPhoto = (p: z.output<typeof photoInput>) => ({src: p.src, credit: p.credit ?? '', creditHref: p.creditHref ?? ''});

export const block = z.discriminatedUnion(
  'type',
  [
    z.object({type: z.literal('p'), text: text('a paragraph', 10_000)}),
    z.object({type: z.literal('h2'), text: text('a heading', 200)}),
    z.object({type: z.literal('quote'), text: text('the quote', 2000), cite: z.string().trim().max(200).optional()}),
    z.object({type: z.literal('image'), image: photoInput.transform(toPhoto), caption: z.string().trim().max(300).optional()}),
    z.object({type: z.literal('list'), items: z.array(text('a list item', 1000)).min(1, 'Add at least one item').max(50)}),
  ],
  {error: 'Use a paragraph, heading, quote, image or list block'}
);

/** Optional SEO override: empty clears it (falls back to the title / first paragraph). */
export const seoText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters`)
    .nullish()
    .transform(s => (s ? s : null));

const slugField = z
  .string({error: 'Enter a slug'})
  .trim()
  .toLowerCase()
  .min(1, 'Enter a slug')
  .max(120, 'Keep the slug under 120 characters')
  .regex(PAGE_SLUG, 'Use lowercase letters, numbers and single dashes')
  .refine(s => !RESERVED.has(s), 'That slug is reserved');

const fields = {
  slug: slugField,
  title: z.string({error: 'Enter a title'}).trim().min(1, 'Enter a title').max(160, 'Keep the title under 160 characters'),
  body: z.array(block, {error: 'Add the page body'}).max(500, 'Keep a page to 500 blocks or fewer'),
  published: z.boolean({error: 'Choose published or hidden'}),
  seoTitle: seoText(70, 'SEO title'),
  seoDescription: seoText(200, 'SEO description'),
};

const createSchema = z.object({...fields, slug: slugField.optional(), body: fields.body.optional(), published: fields.published.optional()});
const patchSchema = z.object(fields).partial();

// ─── Serializers ─────────────────────────────────────────────────────────────

const rowSelect = {
  id: true,
  slug: true,
  title: true,
  published: true,
  seoTitle: true,
  seoDescription: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.PageSelect;

const pageSelect = {...rowSelect, body: true} as const satisfies Prisma.PageSelect;

type RowOf = Prisma.PageGetPayload<{select: typeof rowSelect}>;
type PageOf = Prisma.PageGetPayload<{select: typeof pageSelect}>;

const serializeRow = (p: RowOf): AdminPageRow => ({
  id: String(p.id),
  slug: p.slug,
  title: p.title,
  published: p.published,
  seoTitle: p.seoTitle,
  seoDescription: p.seoDescription,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

const serialize = (p: PageOf): AdminPage => ({
  ...serializeRow(p),
  body: Array.isArray(p.body) ? (p.body as unknown as PostBlock[]) : [],
});

/** `42` → by id; another valid slug → by slug (VAREL accepted either); anything else matches nothing. */
function whereOf(raw: string): Prisma.PageWhereUniqueInput | null {
  if (/^[1-9][0-9]{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647) return {id: Number(raw)};
  if (raw.length <= 120 && PAGE_SLUG.test(raw)) return {slug: raw};
  return null;
}

/** An Int id from the URL, or null (a 404: the URL matches nothing). */
const idOf = (raw: string) => (/^[1-9][0-9]{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : null);

type Ctx = Parameters<typeof apiError>[0];
const notFound = (c: Ctx) => apiError(c, 404, 'not_found', 'We cannot find that page');
const taken = (c: Ctx) => apiError(c, 409, 'slug_taken', 'Another page already uses that slug', {slug: 'That slug is already in use'});

const requestUrl = (c: Ctx) => c.req.url;

export const pagesAdmin = new Hono()
  .get('/', withDb, async c => {
    const rows = await c.var.db.page.findMany({select: rowSelect, orderBy: [{title: 'asc'}, {id: 'asc'}], take: LIST_LIMIT});
    return c.json(rows.map(serializeRow));
  })
  .post('/', json(createSchema), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const slug = input.slug ?? slugify(input.title);
    if (!slug) return apiError(c, 422, 'invalid_input', 'Check the highlighted fields', {slug: 'Enter a slug'});
    if (RESERVED.has(slug)) return apiError(c, 422, 'invalid_input', 'Check the highlighted fields', {slug: 'That slug is reserved'});
    if (await db.page.findUnique({where: {slug}, select: {id: true}})) return taken(c);
    const page = await db.page.create({
      data: {
        slug,
        title: input.title,
        body: (input.body ?? []) as unknown as Prisma.InputJsonValue,
        published: input.published ?? false,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
      },
      select: pageSelect,
    });
    await queueEntityTranslation(db, 'page', String(page.id), {requestUrl: requestUrl(c)});
    return c.json(serialize(page), 201);
  })
  .get('/:id', withDb, async c => {
    const where = whereOf(c.req.param('id'));
    const page = where ? await c.var.db.page.findUnique({where, select: pageSelect}) : null;
    if (!page) return notFound(c);
    return c.json(serialize(page));
  })
  .patch('/:id', json(patchSchema), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const id = idOf(c.req.param('id'));
    const existing = id ? await db.page.findUnique({where: {id}, select: {id: true, slug: true}}) : null;
    if (!existing) return notFound(c);
    if (input.slug && input.slug !== existing.slug && (await db.page.findUnique({where: {slug: input.slug}, select: {id: true}}))) return taken(c);
    const page = await db.page.update({
      where: {id: existing.id},
      data: {
        slug: input.slug,
        title: input.title,
        published: input.published,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        ...(input.body ? {body: input.body as unknown as Prisma.InputJsonValue} : {}),
      },
      select: pageSelect,
    });
    await queueEntityTranslation(db, 'page', String(page.id), {requestUrl: requestUrl(c)});
    return c.json(serialize(page));
  })
  .delete('/:id', withDb, async c => {
    const db = c.var.db;
    const id = idOf(c.req.param('id'));
    const existing = id ? await db.page.findUnique({where: {id}, select: {id: true}}) : null;
    if (!existing) return notFound(c);
    await db.page.delete({where: {id: existing.id}});
    return c.body(null, 204);
  });
