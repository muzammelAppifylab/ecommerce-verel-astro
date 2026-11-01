import type {Context} from 'hono';
import {Hono} from 'hono';
import {z} from 'zod';

import type {Department, FacetCounts, ListingBase, Product} from '../../lib/types/catalog';
import type {SitemapEntry} from '../../lib/types/common';
import {withDb} from '../../platform/guards';
import {CATALOG_LIMIT, listProducts, PUBLISHED, type ListQuery} from '../lib/catalog';
import type {Db} from '../lib/db';
import {publicCache} from '../lib/http';
import {loadFor, locOf, tr, type Loc} from '../lib/i18n/localize';
import {multiValue, query} from '../lib/validate';

/**
 * Catalog listing: taxonomy and product lists (WP-02, docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/catalog.ts (`/taxonomy`, `GET /products`); the listing engine is
 * src/server/lib/catalog.ts (F4). Errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/taxonomy             Department[] with categories and published product counts
 *   GET    /site-api/taxonomy/sitemap     SitemapResponse: /shop/<dept>/, /shop/<dept>/<cat>/
 *   GET    /site-api/products             ProductListResponse ?dept&category&q&color&size&material&brand
 *                                         &maxPrice&tag&sort&limit&featured&base
 *
 * Public, visitor-independent reads: no `withViewer`. Answers are `public` (5 min taxonomy, 1 min
 * products) only when the request names its language in `X-Locale` (islands and the storefront
 * pages do), with `Vary: X-Locale`; otherwise the language came from a cookie or Accept-Language
 * and the answer is `private, no-store`.
 *
 * `/products` is shared with routes/product.ts (`/:slug`, WP-03) and routes/reviews.ts: only the
 * exact `GET /` lives here, middleware per route (never `.use('*')`).
 */

/** Departments (and categories per department) read at most: tiny tables, bounded read. */
const TAXONOMY_LIMIT = 100;

/** Public cache when the language came from `X-Locale`, else private (it came from the visitor). */
function cacheByLocale(c: Context, loc: Loc, seconds: number) {
  const asked = c.req.header('x-locale')?.trim().toLowerCase();
  if (asked && asked === loc.locale) {
    publicCache(c, seconds);
    c.header('Vary', 'X-Locale');
  } else {
    c.header('Cache-Control', 'private, no-store');
  }
}

function readTaxonomy(db: Db) {
  return db.department.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      updatedAt: true,
      categories: {
        select: {id: true, name: true, slug: true, updatedAt: true},
        orderBy: [{position: 'asc'}, {id: 'asc'}],
        take: TAXONOMY_LIMIT,
      },
    },
    orderBy: [{position: 'asc'}, {id: 'asc'}],
    take: TAXONOMY_LIMIT,
  });
}

/** Mounted at `/site-api/taxonomy` (src/server/app.ts). */
export const taxonomyRoutes = new Hono()
  .get('/', withDb, async c => {
    const db = c.var.db;
    // Counts are tallied from a bounded read of published products' ids (VAREL used `_count`, an
    // aggregate per request): published products, sold-out included (VAREL parity).
    const [depts, products, loc] = await Promise.all([
      readTaxonomy(db),
      db.product.findMany({
        where: PUBLISHED,
        select: {departmentId: true, categoryId: true},
        orderBy: [{position: 'asc'}, {id: 'asc'}],
        take: CATALOG_LIMIT,
      }),
      locOf(c),
    ]);
    const deptCount = new Map<number, number>();
    const catCount = new Map<number, number>();
    for (const p of products) {
      deptCount.set(p.departmentId, (deptCount.get(p.departmentId) ?? 0) + 1);
      catCount.set(p.categoryId, (catCount.get(p.categoryId) ?? 0) + 1);
    }
    // Names in the request language (VAREL puts them in `name`; `label` carries the same text);
    // slugs stay the link values.
    const [deptTr, catTr] = await Promise.all([
      loadFor(db, loc, 'department', depts.map(d => d.id), ['name']),
      loadFor(db, loc, 'category', depts.flatMap(d => d.categories.map(cat => cat.id)), ['name']),
    ]);
    const out: Department[] = depts.map(d => {
      const name = tr(deptTr, d.id, 'name', d.name);
      return {
        name,
        slug: d.slug,
        label: name,
        categories: d.categories.map(cat => {
          const catName = tr(catTr, cat.id, 'name', cat.name);
          return {name: catName, slug: cat.slug, label: catName, count: catCount.get(cat.id) ?? 0};
        }),
        count: deptCount.get(d.id) ?? 0,
      };
    });
    cacheByLocale(c, loc, 300);
    return c.json(out);
  })
  // Every department and category, empty ones too (VAREL html.ts sitemap); slugs are language-free.
  .get('/sitemap', withDb, async c => {
    const depts = await readTaxonomy(c.var.db);
    const iso = (...dates: Date[]) => new Date(Math.max(...dates.map(d => d.getTime()))).toISOString();
    const items: SitemapEntry[] = depts.flatMap(d => [
      {path: `/shop/${encodeURIComponent(d.slug)}/`, updatedAt: iso(d.updatedAt)},
      ...d.categories.map(cat => ({
        path: `/shop/${encodeURIComponent(d.slug)}/${encodeURIComponent(cat.slug)}/`,
        updatedAt: iso(d.updatedAt, cat.updatedAt),
      })),
    ]);
    publicCache(c, 3600);
    return c.json({items});
  });

/** A multi-value filter: comma-separated or repeated; values past `maxValues` are dropped, long ones refused. */
const multi = (maxValues: number, maxLen: number) =>
  multiValue(maxValues).refine(vs => vs.every(v => v.length <= maxLen), `Keep each value under ${maxLen} characters`);

/** `GET /products` query (VAREL listQuery; `limit` defaults to 100, `base` is new). */
export const listQuery = z.object({
  dept: multi(10, 80),
  category: multi(20, 80),
  q: z.string().trim().max(200).optional().default(''),
  color: multi(20, 60),
  size: multi(20, 60),
  material: multi(20, 120),
  brand: multi(20, 80),
  tag: multi(20, 40),
  maxPrice: z.coerce
    .number({error: 'Enter a price'})
    .refine(Number.isFinite, 'Enter a price')
    .refine(n => n >= 0, 'Enter a price of zero or more')
    .optional(),
  sort: z
    .enum(['featured', 'newest', 'price-asc', 'price-desc'], {error: 'Sort by featured, newest, price-asc or price-desc'})
    .optional()
    .default('featured'),
  limit: z.coerce
    .number({error: 'Use a whole number'})
    .int('Use a whole number')
    .min(1, 'Use a limit of at least 1')
    .max(100, 'Use a limit of 100 or less')
    .optional()
    .default(100),
  featured: z
    .enum(['true', 'false', '1', '0'], {error: 'Use featured=true or featured=false'})
    .optional()
    .transform(v => v === 'true' || v === '1'),
  base: z.enum(['dept', 'category'], {error: 'Use base=dept or base=category'}).optional(),
});

/** Base-listing value counts (VAREL useListingParams `facetCount`, moved to the server). */
export function facetCounts(items: Product[], facets: ListingBase['facets']): FacetCounts {
  const out: FacetCounts = {};
  for (const f of facets) {
    const counts: Record<string, number> = {};
    for (const value of f.values) {
      counts[value] = items.filter(p => {
        if (f.key === 'color') return p.variants.some(v => v.color === value);
        if (f.key === 'size') return p.variants.some(v => v.size === value);
        return p[f.key] === value;
      }).length;
    }
    out[f.key] = counts;
  }
  return out;
}

/** Mounted at `/site-api/products` (src/server/app.ts). */
export const catalogRoutes = new Hono().get('/', query(listQuery), withDb, async c => {
  const {base: baseKind, ...q} = c.req.valid('query');
  const db = c.var.db;
  const loc = await locOf(c);
  // The base listing (route scope only: the department, plus the category on category pages; no
  // facet filters, no `q`) feeds the filter panel; VAREL's pages read it with a second browser call.
  const baseQuery: ListQuery | null = baseKind
    ? {
        dept: q.dept,
        category: baseKind === 'category' ? q.category : [],
        q: '',
        color: [],
        size: [],
        material: [],
        brand: [],
        tag: [],
        featured: false,
        sort: 'featured',
      }
    : null;
  const [list, base] = await Promise.all([
    listProducts(db, q, loc),
    baseQuery ? listProducts(db, baseQuery, loc) : Promise.resolve(null),
  ]);
  cacheByLocale(c, loc, 60);
  if (!base) return c.json(list);
  const summary: ListingBase = {
    facets: base.facets,
    priceMax: base.priceMax,
    total: base.total,
    counts: facetCounts(base.items, base.facets),
  };
  return c.json({...list, base: summary});
});
