import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import {withDb} from '../../../platform/guards';
import type {AdminPost, AdminPostRow, PostBlock, PostStatus} from '../../../lib/types/admin/content';
import {queueEntityTranslation, type Db} from '../../lib/contracts';
import {slugify} from '../../lib/format';
import {
  apiError,
  type CursorValue,
  cursorDate,
  decodeCursor,
  keysetPage,
  keysetWhere,
  orderByOf,
  pageSizeOf,
  parseSort,
  sortProblem,
} from '../../lib/http';
import {asPhoto} from '../../lib/serializers';
import {invalidInput, json, multiValue, pageQuery, query} from '../../lib/validate';

/**
 * Admin: Journal posts. Port of VAREL worker/routes/admin/posts.ts (WP-06, docs/migration/PLAN.md §5).
 * VAREL `/api/admin/posts…` is `/site-api/manage/posts…` here. Shapes: src/lib/types/admin/content.ts.
 * Drafts and future-dated posts stay off the storefront (routes/posts.ts).
 *
 *   GET    /site-api/manage/posts                      CursorPage<AdminPostRow> ?q&status&category&sort&cursor&pageSize
 *   POST   /site-api/manage/posts                      AdminPostInput → 201 AdminPost; 409 slug_taken
 *   GET    /site-api/manage/posts/:slug                AdminPost
 *   PATCH  /site-api/manage/posts/:slug                Partial<AdminPostInput> → AdminPost
 *   DELETE /site-api/manage/posts/:slug                204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: content, reads too), then the activity log. Handlers add their validator and `withDb`.
 * Source fields only: translations are queued after a save (contracts `queueEntityTranslation`).
 */

// ─── Input rules (client = server: src/portal/screens/journal/form.ts mirrors them) ───

const text = (empty: string, max: number, tooLong: string) => z.string({error: empty}).trim().min(1, empty).max(max, tooLong);

/** A cover or block image: an https URL, or a file uploaded here (platform files / VAREL media links). */
export const isImageSrc = (s: string) => /^https:\/\//i.test(s) || s.startsWith('/site-api/media/') || s.startsWith('/__platform/files/');

const imageSrc = (empty: string) =>
  z
    .string({error: empty})
    .trim()
    .min(1, empty)
    .max(2000, 'Keep the image address under 2000 characters')
    .refine(isImageSrc, 'Use an https:// URL or upload the image.');

const creditHref = z
  .string()
  .trim()
  .max(2000, 'Keep the link under 2000 characters')
  .refine(s => !s || /^https?:\/\/\S+$/i.test(s), 'Enter a full URL, starting https://')
  .nullish();

const toPhoto = (p: {src: string; credit?: string | null; creditHref?: string | null}) => ({
  src: p.src,
  credit: p.credit ?? '',
  creditHref: p.creditHref ?? '',
});

/** A post's cover image (`{src, credit, creditHref}`). */
export const photoInput = z
  .object({
    src: imageSrc('Add a cover image.'),
    credit: z.string().trim().max(200, 'Keep the credit under 200 characters').nullish(),
    creditHref,
  })
  .transform(toPhoto);

const blockImage = z
  .object({
    src: imageSrc('Upload an image or paste its URL.'),
    credit: z.string().trim().max(200, 'Keep the credit under 200 characters').nullish(),
    creditHref,
  })
  .transform(toPhoto);

/** One body block (VAREL `block`): paragraph, heading, quote, image or list. WP-07 (CMS pages) uses it too. */
export const block = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('p'),
      text: text('Write the paragraph or remove the block.', 10_000, 'Keep a paragraph under 10000 characters'),
    }),
    z.object({
      type: z.literal('h2'),
      text: text('Add the heading text or remove the block.', 200, 'Keep a heading under 200 characters'),
    }),
    z.object({
      type: z.literal('quote'),
      text: text('Add the quote or remove the block.', 2000, 'Keep a quote under 2000 characters'),
      cite: z.string().trim().max(200, 'Keep the citation under 200 characters').optional(),
    }),
    z.object({
      type: z.literal('image'),
      image: blockImage,
      caption: z.string().trim().max(300, 'Keep the caption under 300 characters').optional(),
    }),
    z.object({
      type: z.literal('list'),
      items: z
        .array(text('Write the list item or remove it.', 1000, 'Keep a list item under 1000 characters'))
        .min(1, 'Add at least one list item.')
        .max(50, 'Keep a list under 50 items'),
    }),
  ],
  {error: 'Use a paragraph, heading, quote, image or list block'}
);

/** Optional SEO override: empty clears it (falls back to the title / excerpt). */
export const seoText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters`)
    .nullish()
    .transform(s => (s ? s : null));

const isoDate = z
  .string({error: 'Use a date and time'})
  .trim()
  .refine(s => !Number.isNaN(Date.parse(s)), 'Use a date and time')
  .transform(s => new Date(s))
  .nullable();

/** Slugs the public routes use as paths (`/posts/categories`…): never a post. */
export const RESERVED_SLUGS = ['categories', 'feed', 'sitemap'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fields = {
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(120, 'Keep the slug under 120 characters')
    .regex(SLUG_RE, 'Use lowercase letters, numbers and hyphens.')
    .refine(s => !RESERVED_SLUGS.includes(s), 'That slug is reserved')
    .optional(),
  title: text('Give the post a title.', 160, 'Keep the title under 160 characters.'),
  category: text('Choose or type a category.', 60, 'Keep the category short.'),
  author: text('Who wrote this?', 80, 'Keep the author under 80 characters.'),
  status: z.enum(['draft', 'published'], {error: 'Choose draft or published'}),
  publishedAt: isoDate,
  excerpt: text('Write a one- or two-line excerpt.', 320, 'Keep the excerpt under 320 characters.'),
  image: photoInput,
  body: z.array(block, {error: 'Add the article body'}).min(1, 'Add at least one block.').max(500, 'Keep the body under 500 blocks'),
  seoTitle: seoText(70, 'SEO title'),
  seoDescription: seoText(200, 'SEO description'),
};

export const createSchema = z.object({...fields, publishedAt: fields.publishedAt.optional()});
export const patchSchema = z.object(fields).partial();

/** "6 min read" at ~200 words a minute (stored English; the storefront localises it). */
export function readTime(blocks: PostBlock[]): string {
  const words = blocks
    .map(b => (b.type === 'list' ? b.items.join(' ') : b.type === 'image' ? (b.caption ?? '') : b.text))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 200))} min read`;
}

// ─── Serializers (VAREL admin/serializers.ts §Content) ───

const rowSelect = {
  id: true,
  slug: true,
  title: true,
  category: true,
  author: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  image: true,
} satisfies Prisma.PostSelect;

const postSelect = {...rowSelect, excerpt: true, read: true, body: true, seoTitle: true, seoDescription: true} satisfies Prisma.PostSelect;

type RowShape = Prisma.PostGetPayload<{select: typeof rowSelect}>;
type PostShape = Prisma.PostGetPayload<{select: typeof postSelect}>;

export function adminPostRow(p: RowShape): AdminPostRow {
  return {
    id: String(p.id),
    slug: p.slug,
    title: p.title,
    category: p.category,
    author: p.author,
    status: p.status as PostStatus,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
    image: asPhoto(p.image),
  };
}

export function adminPost(p: PostShape): AdminPost {
  return {
    ...adminPostRow(p),
    excerpt: p.excerpt,
    read: p.read,
    body: (Array.isArray(p.body) ? p.body : []) as unknown as PostBlock[],
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
  };
}

// ─── List: keyset per sort ───

export const POST_SORT_FIELDS = ['title', 'category', 'status', 'publishedAt', 'updatedAt'] as const;
type SortField = (typeof POST_SORT_FIELDS)[number];

/**
 * The keyset clause and order for one sort. `publishedAt` is nullable (drafts): it sorts nulls last
 * in both directions (VAREL), so the clause after a dated row also takes every undated row.
 */
export function postsKeyset(
  field: SortField,
  dir: 'asc' | 'desc',
  after: CursorValue[] | null
): {where: Prisma.PostWhereInput; orderBy: Prisma.PostOrderByWithRelationInput[]} {
  const op = dir === 'desc' ? 'lt' : 'gt';
  const id = after && typeof after[1] === 'number' ? after[1] : null;
  if (field === 'publishedAt') {
    const orderBy: Prisma.PostOrderByWithRelationInput[] = [{publishedAt: {sort: dir, nulls: 'last'}}, {id: dir}];
    if (id === null) return {where: {}, orderBy};
    const at = after![0] === null ? null : cursorDate(after![0]);
    if (!at) return {where: {publishedAt: null, id: {[op]: id}}, orderBy};
    return {where: {OR: [{publishedAt: {[op]: at}}, {publishedAt: at, id: {[op]: id}}, {publishedAt: null}]}, orderBy};
  }
  const orderBy = orderByOf(field, dir) as Prisma.PostOrderByWithRelationInput[];
  if (id === null) return {where: {}, orderBy};
  const value = field === 'updatedAt' ? cursorDate(after![0]) : after![0];
  if (value === null || value === undefined) return {where: {}, orderBy};
  return {where: keysetWhere(field, dir, [value, id]) as Prisma.PostWhereInput, orderBy};
}

const cursorOf = (field: SortField) => (p: RowShape) => [p[field] ?? null, p.id] as (CursorValue | Date)[];

const listQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  status: multiValue(2),
  category: z.string().trim().max(60, 'Keep the category under 60 characters').optional(),
  sort: z.string().trim().max(40).optional(),
  ...pageQuery,
});

async function findBySlug(db: Db, slug: string) {
  return db.post.findUnique({where: {slug}, select: postSelect});
}

const notFound = 'We cannot find that journal entry';

/** P2002 on the slug (two creates racing): the same 409 as the check. */
const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as {code?: string}).code === 'P2002';

/** Mounted at `/site-api/manage/posts` (src/server/routes/admin/index.ts). */
export const postsAdmin = new Hono()
  .get('/', query(listQuery), withDb, async c => {
    const q = c.req.valid('query');
    const sort = parseSort(q.sort, POST_SORT_FIELDS, '-updatedAt');
    if (!sort) return c.json(invalidInput(sortProblem(POST_SORT_FIELDS)), 422);
    const size = pageSizeOf(q.pageSize);
    const statuses = q.status.filter((s): s is PostStatus => s === 'draft' || s === 'published');
    const words = (q.q ?? '').split(/\s+/).filter(Boolean).slice(0, 10);
    const keyset = postsKeyset(sort.field, sort.dir, decodeCursor(q.cursor));
    const where: Prisma.PostWhereInput = {
      AND: [
        statuses.length ? {status: {in: statuses}} : {},
        q.category ? {category: {equals: q.category, mode: 'insensitive'}} : {},
        ...words.map(w => ({
          OR: [
            {title: {contains: w, mode: 'insensitive' as const}},
            {excerpt: {contains: w, mode: 'insensitive' as const}},
            {author: {contains: w, mode: 'insensitive' as const}},
            {slug: {contains: w, mode: 'insensitive' as const}},
          ],
        })),
        keyset.where,
      ],
    };
    const rows = await c.var.db.post.findMany({where, select: rowSelect, orderBy: keyset.orderBy, take: size + 1});
    const page = keysetPage(rows, size, cursorOf(sort.field));
    return c.json({items: page.items.map(adminPostRow), nextCursor: page.nextCursor});
  })
  .post('/', json(createSchema), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const slug = input.slug ?? slugify(input.title).slice(0, 120).replace(/-+$/, '');
    if (!slug) return c.json(invalidInput({slug: 'Enter a slug'}), 422);
    if (RESERVED_SLUGS.includes(slug)) return c.json(invalidInput({slug: 'That slug is reserved'}), 422);
    const taken = () =>
      apiError(c, 409, 'slug_taken', 'Another journal entry already uses that slug', {slug: `${slug} is already taken`});
    if (await db.post.findUnique({where: {slug}, select: {id: true}})) return taken();
    const blocks = input.body as PostBlock[];
    let post: PostShape;
    try {
      post = await db.post.create({
        data: {
          slug,
          title: input.title,
          category: input.category,
          author: input.author,
          status: input.status,
          publishedAt: input.publishedAt ?? (input.status === 'published' ? new Date() : null),
          excerpt: input.excerpt,
          image: input.image,
          body: blocks as unknown as Prisma.InputJsonValue,
          read: readTime(blocks),
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
        },
        select: postSelect,
      });
    } catch (e) {
      if (isUniqueViolation(e)) return taken();
      throw e;
    }
    await queueEntityTranslation(db, 'post', post.id, {requestUrl: c.req.url});
    return c.json(adminPost(post), 201);
  })
  .get('/:slug', withDb, async c => {
    const post = await findBySlug(c.var.db, c.req.param('slug'));
    if (!post) return apiError(c, 404, 'not_found', notFound);
    return c.json(adminPost(post));
  })
  .patch('/:slug', json(patchSchema), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const existing = await db.post.findUnique({
      where: {slug: c.req.param('slug')},
      select: {id: true, slug: true, status: true, publishedAt: true},
    });
    if (!existing) return apiError(c, 404, 'not_found', notFound);
    if (input.slug && input.slug !== existing.slug) {
      return c.json(invalidInput({slug: 'The slug cannot change after a journal entry is created'}), 422);
    }
    const status = input.status ?? existing.status;
    let publishedAt = input.publishedAt !== undefined ? input.publishedAt : existing.publishedAt;
    // Publishing without a date goes live now; moving to drafts keeps the date (VAREL).
    if (status === 'published' && !publishedAt) publishedAt = new Date();
    const blocks = input.body as PostBlock[] | undefined;
    const data: Prisma.PostUpdateInput = {publishedAt};
    if (input.title !== undefined) data.title = input.title;
    if (input.category !== undefined) data.category = input.category;
    if (input.author !== undefined) data.author = input.author;
    if (input.status !== undefined) data.status = input.status;
    if (input.excerpt !== undefined) data.excerpt = input.excerpt;
    if (input.image !== undefined) data.image = input.image;
    if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle;
    if (input.seoDescription !== undefined) data.seoDescription = input.seoDescription;
    if (blocks) {
      data.body = blocks as unknown as Prisma.InputJsonValue;
      data.read = readTime(blocks);
    }
    const post = await db.post.update({where: {id: existing.id}, data, select: postSelect});
    await queueEntityTranslation(db, 'post', post.id, {requestUrl: c.req.url});
    return c.json(adminPost(post));
  })
  .delete('/:slug', withDb, async c => {
    const {count} = await c.var.db.post.deleteMany({where: {slug: c.req.param('slug')}});
    if (count === 0) return apiError(c, 404, 'not_found', notFound);
    return c.body(null, 204);
  });
