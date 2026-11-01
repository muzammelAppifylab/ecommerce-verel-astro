import type {Context} from 'hono';
import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../generated/prisma/client';
import {withDb} from '../../platform/guards';
import type {SitemapEntry} from '../../lib/types/common';
import type {FeedItem, Post, PostCategory, PostDetail} from '../../lib/types/content';
import type {Db} from '../lib/contracts';
import {slugify} from '../lib/format';
import {apiError, publicCache} from '../lib/http';
import {loadFor, locOf, tr, type Loc} from '../lib/i18n/localize';
import {serializePost, serializePostDetail, type PostTr} from '../lib/serializers';
import {params, query} from '../lib/validate';

/**
 * Journal (public). Port of VAREL worker/routes/posts.ts (WP-06, docs/migration/PLAN.md §5).
 * VAREL `/api/<path>` is `/site-api/<path>` here, same shapes (src/lib/types/content.ts),
 * errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/posts                             Post[] ?category=&limit= newest first (published, publishedAt ≤ now)
 *   GET    /site-api/posts/categories                  PostCategory[] (most recent post first)
 *   GET    /site-api/posts/sitemap                     SitemapResponse: `/journal/<slug>/` + `/journal/category/<c>/`
 *   GET    /site-api/posts/feed                        FeedResponse: the 20 newest published posts for /rss.xml
 *   GET    /site-api/posts/:slug                       PostDetail; 404 unless published
 *
 * Public, visitor-independent reads: no `withViewer`; cached `public` with `Vary` on the language
 * inputs (`X-Locale`, `Accept-Language`, the language cookie). A 404 is never cached.
 * Bounded: lists read ≤ 100 rows (VAREL read every post), the detail ≤ 7 rows.
 */

/** Journal visibility: published, with publishedAt in the past. (VAREL `publishedPosts`; WP-08 search uses it too.) */
export const publishedWhere = (now = new Date()) => ({status: 'published' as const, publishedAt: {lte: now}});

/** Every column the serializers read except the body and SEO fields (cards). */
const listSelect = {
  id: true,
  slug: true,
  title: true,
  category: true,
  status: true,
  publishedAt: true,
  read: true,
  author: true,
  excerpt: true,
  image: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PostSelect;

/** The detail adds the body and the SEO overrides. */
const detailSelect = {...listSelect, body: true, seoTitle: true, seoDescription: true} satisfies Prisma.PostSelect;

type ListRow = Prisma.PostGetPayload<{select: typeof listSelect}>;
type PostRow = Prisma.PostGetPayload<object>;

/** A card row as the serializer's full row type (the body and SEO fields it does not read for cards left empty). */
const asRow = (r: ListRow): PostRow => ({...r, body: [], seoTitle: null, seoDescription: null});

const NEWEST = [{publishedAt: 'desc' as const}, {id: 'desc' as const}];

/** Rows the public lists read at most (template row limit; the seed has 6 posts). */
export const POSTS_LIMIT = 100;

/** Journal overlays for a set of posts: one query for posts, one for their categories. */
export async function loadPostTr(db: Db, loc: Loc, posts: {id: number; category: string}[], fields?: string[]): Promise<PostTr> {
  const [post, category] = await Promise.all([
    loadFor(
      db,
      loc,
      'post',
      posts.map(p => p.id),
      fields
    ),
    loadFor(
      db,
      loc,
      'post_category',
      posts.map(p => p.category),
      ['name']
    ),
  ]);
  return {post, category};
}

/**
 * The published categories, most recent post first, with their counts and labels in the request
 * language. Counts come from the newest ≤ 100 published posts (exact until the journal passes 100
 * posts; VAREL used an unbounded `groupBy`).
 */
export async function postCategories(db: Db, loc: Loc, now = new Date()): Promise<PostCategory[]> {
  const rows = await db.post.findMany({
    where: publishedWhere(now),
    select: {category: true},
    orderBy: NEWEST,
    take: POSTS_LIMIT,
  });
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const names = [...counts.keys()];
  const labels = await loadFor(db, loc, 'post_category', names, ['name']);
  return names.map(name => ({name, count: counts.get(name)!, label: tr(labels, name, 'name', name)}));
}

/** The English category name for a `?category=` value: its slug, or the slug of its translated label. */
async function resolveCategory(db: Db, loc: Loc, raw: string, now: Date): Promise<string | null> {
  const want = slugify(raw);
  if (!want) return null;
  const cats = await postCategories(db, loc, now);
  const hit = cats.find(c => slugify(c.name) === want || slugify(c.label ?? '') === want);
  return hit?.name ?? null;
}

/** Public cache for reads that depend on the request language. */
function languageCache(c: Context, seconds: number) {
  publicCache(c, seconds);
  c.header('Vary', 'X-Locale, Accept-Language, Cookie');
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const LIMIT_MESSAGE = 'Use a number from 1 to 100';
const listQuery = z.object({
  category: z.string().trim().max(80, 'Keep the category under 80 characters').optional(),
  limit: z.coerce
    .number({error: LIMIT_MESSAGE})
    .int(LIMIT_MESSAGE)
    .min(1, LIMIT_MESSAGE)
    .max(POSTS_LIMIT, LIMIT_MESSAGE)
    .optional(),
});

/** Mounted at `/site-api/posts` (src/server/app.ts). */
export const postRoutes = new Hono()
  .get('/', query(listQuery), withDb, async c => {
    const {category, limit} = c.req.valid('query');
    const db = c.var.db;
    const now = new Date();
    const loc = await locOf(c);
    let name: string | null = null;
    if (category) {
      // The filter accepts the English name (link value) or its translation; unknown → [] (VAREL).
      name = await resolveCategory(db, loc, category, now);
      if (!name) {
        languageCache(c, 300);
        return c.json([] as Post[]);
      }
    }
    const rows = await db.post.findMany({
      where: {...publishedWhere(now), ...(name ? {category: name} : {})},
      select: listSelect,
      orderBy: NEWEST,
      take: limit ?? POSTS_LIMIT,
    });
    const ptr = await loadPostTr(db, loc, rows, ['title', 'excerpt']);
    languageCache(c, 300);
    return c.json(rows.map(r => serializePost(asRow(r), loc, ptr)) as Post[]);
  })
  // Static paths before /:slug so "categories" is never read as a slug.
  .get('/categories', withDb, async c => {
    const loc = await locOf(c);
    const out = await postCategories(c.var.db, loc);
    languageCache(c, 300);
    return c.json(out);
  })
  .get('/sitemap', withDb, async c => {
    const db = c.var.db;
    const now = new Date();
    const [posts, cats] = await Promise.all([
      db.post.findMany({where: publishedWhere(now), select: {slug: true, updatedAt: true}, orderBy: NEWEST, take: 1000}),
      db.post.findMany({where: publishedWhere(now), select: {category: true}, orderBy: NEWEST, take: POSTS_LIMIT}),
    ]);
    const categories = [...new Set(cats.map(r => slugify(r.category)).filter(Boolean))];
    const items: SitemapEntry[] = [
      ...posts.map(p => ({path: `/journal/${p.slug}/`, updatedAt: p.updatedAt.toISOString()})),
      ...categories.map(slug => ({path: `/journal/category/${slug}/`, updatedAt: null})),
    ];
    publicCache(c, 3600);
    return c.json({items});
  })
  .get('/feed', withDb, async c => {
    const rows = await c.var.db.post.findMany({
      where: publishedWhere(),
      select: {slug: true, title: true, excerpt: true, category: true, author: true, publishedAt: true, createdAt: true},
      orderBy: NEWEST,
      take: 20,
    });
    // Source language: the feed is one document for every reader.
    const items: FeedItem[] = rows.map(r => ({
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      category: r.category,
      author: r.author,
      publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
    }));
    publicCache(c, 3600);
    return c.json({items});
  })
  .get('/:slug', params(z.object({slug: z.string()})), withDb, async c => {
    const {slug} = c.req.valid('param');
    // An impossible slug is "not found", not 422, and costs no query. Never cached (default no-store).
    if (slug.length > 120 || !SLUG_RE.test(slug)) return apiError(c, 404, 'not_found', 'We cannot find that journal entry');
    const db = c.var.db;
    const now = new Date();
    const post = await db.post.findFirst({where: {slug, ...publishedWhere(now)}, select: detailSelect});
    if (!post) return apiError(c, 404, 'not_found', 'We cannot find that journal entry');
    // Same category first, then the newest others (VAREL), each bounded to 3.
    const [same, others, loc] = await Promise.all([
      db.post.findMany({
        where: {...publishedWhere(now), id: {not: post.id}, category: post.category},
        select: listSelect,
        orderBy: NEWEST,
        take: 3,
      }),
      db.post.findMany({
        where: {...publishedWhere(now), id: {not: post.id}, category: {not: post.category}},
        select: listSelect,
        orderBy: NEWEST,
        take: 3,
      }),
      locOf(c),
    ]);
    const related = [...same, ...others].slice(0, 3);
    const ptr = await loadPostTr(db, loc, [post, ...related]);
    const detail: PostDetail = {
      ...(serializePostDetail(post, related.map(asRow), loc, ptr) as PostDetail),
      seoTitle: post.seoTitle ? tr(ptr.post, post.id, 'seoTitle', post.seoTitle) : null,
      seoDescription: post.seoDescription ? tr(ptr.post, post.id, 'seoDescription', post.seoDescription) : null,
      updatedAt: post.updatedAt.toISOString(),
    };
    languageCache(c, 300);
    return c.json(detail);
  });
