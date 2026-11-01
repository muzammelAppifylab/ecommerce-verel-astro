import {Hono} from 'hono';
import {z} from 'zod';

import type {SearchResponse} from '../../lib/types/catalog';
import {withDb} from '../../platform/guards';
import {allProducts, listable, matchesQuery} from '../lib/catalog';
import {loadCatalogTr, loadFor, locOf, tr} from '../lib/i18n/localize';
import {loadProductPromotions} from '../lib/promotions-loader';
import {categoryName, departmentName, type PostTr, serializePost, serializeProduct} from '../lib/serializers';
import {getSettings} from '../lib/settings';
import {query} from '../lib/validate';
import {rateLimit} from '../lib/rate-limit';

/**
 * Search (WP-08). Port of VAREL worker/routes/search.ts.
 *
 *   GET    /site-api/search?q=                        SearchResponse (src/lib/types/catalog.ts)
 *
 * Products, categories and journal posts whose text holds every word of `q` (case-insensitive substring),
 * in the source language AND the request language (translated names, categories, colours, post titles).
 * Matching is in memory, as in VAREL, over bounded reads: at most CATALOG_LIMIT (100) published products
 * (F4 `allProducts`), SEARCH_LIMIT categories and SEARCH_LIMIT published posts, each with an explicit select.
 * No paging: one bounded answer ordered by merchandising (products), department/category position
 * (categories) and newest first (posts). No `count()`: a category's count comes from the loaded products.
 * The trigram indexes (F1: products_*_trgm_idx, posts_*_trgm_idx) are the path when the catalog outgrows
 * that cap (docs/migration/handoff/WP-08.md "Known gaps").
 */

/** Most rows of each kind read and returned (bounded queries, AGENTS.md). */
export const SEARCH_LIMIT = 100;

export const searchQuery = z.object({
  q: z.string().trim().max(200, 'Keep this under 200 characters').optional().default(''),
});

const EMPTY: SearchResponse = {query: '', products: [], categories: [], posts: []};

/** VAREL routes/posts.ts `publishedPosts()`: published and not scheduled for later (WP-06 owns posts.ts). */
const publishedPosts = () => ({status: 'published', publishedAt: {lte: new Date()}});

const postSelect = {
  id: true,
  slug: true,
  title: true,
  category: true,
  publishedAt: true,
  createdAt: true,
  read: true,
  author: true,
  excerpt: true,
  image: true,
} as const;

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  departmentId: true,
  department: {select: {id: true, name: true, slug: true}},
} as const;

type Hit = SearchResponse['categories'][number];
type Named = {id: number; name: string; slug: string};

/** The answer depends on the request language (X-Locale / cookie / Accept-Language): never `public`. */
const PRIVATE_CACHE = 'private, max-age=30';

/** Mounted at `/site-api/search` (src/server/app.ts). */
export const searchRoutes = new Hono().get('/', query(searchQuery), withDb, async c => {
  // Each search loads the catalogue: limited per IP (I2, WP-08 request).
  await rateLimit(c, c.var.db, 'search');
  const {q} = c.req.valid('query');
  if (!q) {
    // An empty term never reaches the database.
    c.header('Cache-Control', PRIVATE_CACHE);
    return c.json(EMPTY);
  }
  const db = c.var.db;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const loc = await locOf(c);
  const [all, settings, promos, allCats, allPosts] = await Promise.all([
    allProducts(db),
    getSettings(db),
    loadProductPromotions(db, undefined, loc),
    // Category names are matched in JS so translated names match too (a few dozen rows).
    db.category.findMany({
      select: categorySelect,
      orderBy: [{department: {position: 'asc'}}, {position: 'asc'}, {id: 'asc'}],
      take: SEARCH_LIMIT,
    }),
    db.post.findMany({
      where: publishedPosts(),
      select: postSelect,
      orderBy: [{publishedAt: 'desc'}, {id: 'desc'}],
      take: SEARCH_LIMIT,
    }),
  ]);
  const [ctr, postMap, postCatMap] = await Promise.all([
    loadCatalogTr(db, loc, all, {
      categories: allCats.map(x => x.id),
      departments: allCats.map(x => x.departmentId),
    }),
    loadFor(db, loc, 'post', allPosts.map(p => p.id), ['title', 'excerpt']),
    loadFor(db, loc, 'post_category', [...new Set(allPosts.map(p => p.category))], ['name']),
  ]);
  const ptr: PostTr = {post: postMap, category: postCatMap};
  const products = all.filter(listable(settings)).filter(p => matchesQuery(p, q, ctr));

  // Categories: those holding a matching product, plus any whose name matches the query.
  const cats = new Map<string, Hit>();
  const hit = (dept: Named, cat: Named, count: number): Hit => ({
    dept: dept.name,
    category: cat.name,
    count,
    deptLabel: departmentName(ctr, dept),
    categoryLabel: categoryName(ctr, cat),
    deptSlug: dept.slug,
    categorySlug: cat.slug,
  });
  for (const p of products) {
    const key = `${p.department.name}/${p.category.name}`;
    const cat = cats.get(key) ?? hit(p.department, p.category, 0);
    cat.count++;
    cats.set(key, cat);
  }
  // VAREL counted a category's published products (`_count`, sold-out included): read from the loaded list.
  const published = new Map<number, number>();
  for (const p of all) published.set(p.categoryId, (published.get(p.categoryId) ?? 0) + 1);
  for (const cat of allCats) {
    const text = `${cat.name} ${categoryName(ctr, cat)}`.toLowerCase();
    if (!words.every(w => text.includes(w))) continue;
    const key = `${cat.department.name}/${cat.name}`;
    if (!cats.has(key)) cats.set(key, hit(cat.department, cat, published.get(cat.id) ?? 0));
  }

  const posts = allPosts.filter(p => {
    const text = [
      p.title,
      p.excerpt,
      p.category,
      p.author,
      tr(postMap, p.id, 'title', ''),
      tr(postMap, p.id, 'excerpt', ''),
      tr(postCatMap, p.category, 'name', ''),
    ]
      .join(' ')
      .toLowerCase();
    return words.every(w => text.includes(w));
  });

  const out: SearchResponse = {
    query: q,
    products: products
      .slice(0, SEARCH_LIMIT)
      .map(p => serializeProduct(p, settings.lowStockThreshold, promos, loc, ctr)),
    categories: [...cats.values()].slice(0, SEARCH_LIMIT),
    // serializePost reads only the selected columns (F4 types it with the full row).
    posts: posts.map(p => serializePost(p as Parameters<typeof serializePost>[0], loc, ptr)),
  };
  c.header('Cache-Control', PRIVATE_CACHE);
  return c.json(out);
});
