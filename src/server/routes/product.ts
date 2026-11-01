import {Hono} from 'hono';
import {z} from 'zod';

import type {Product} from '../../lib/types/catalog';
import type {SitemapEntry} from '../../lib/types/common';
import {withDb} from '../../platform/guards';
import {relatedProducts} from '../lib/catalog';
import {notFound} from '../lib/errors';
import {loadCatalogTr, locOf} from '../lib/i18n/localize';
import {publicCache} from '../lib/http';
import {withLocale} from '../lib/locale';
import {loadProductPromotions} from '../lib/promotions-loader';
import {productSelect, serializeProduct} from '../lib/serializers';
import {getSettings} from '../lib/settings';
import {query} from '../lib/validate';

/**
 * Product detail (WP-03, docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/catalog.ts (`GET /products/:slug`, `/:slug/related`) and the product rows of
 * worker/routes/html.ts (sitemap). VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/catalog.ts), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/products/sitemap                  SitemapResponse: `/product/<slug>/` of published products, ≤ 1000
 *   GET    /site-api/products/:slug                    Product; 404 unless published
 *   GET    /site-api/products/:slug/related            Product[] ?limit=4 (1–24; same dept or category first)
 *
 * Public reads: no viewer, no CSRF (GET). `withDb → withLocale` per route, never `.use('*')`: catalog.ts
 * and reviews.ts share the `/products` mount. `/sitemap` stays before `/:slug`, and `/:slug` never shadows
 * `/:slug/reviews*` (WP-04): Hono matches `/:slug` exactly.
 */

/** Product ids are lowercase slugs (`products.id VarChar(120)`). Anything else is an unknown URL: 404, not 422. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const MISSING = 'We cannot find that product';

export function validSlug(raw: string | undefined): string | null {
  const slug = (raw ?? '').trim();
  return slug.length >= 1 && slug.length <= 120 && SLUG.test(slug) ? slug : null;
}

/** The detail read: the storefront select plus the SEO overrides (never cost, weights or packages). */
export const productDetailSelect = {...productSelect, seoTitle: true, seoDescription: true} as const;

const LIMIT_MESSAGE = 'Use a limit between 1 and 24';

/** VAREL relatedQuery: `?limit=` an integer 1–24, default 4. */
const relatedQuery = z.object({
  limit: z.coerce
    .number({error: LIMIT_MESSAGE})
    .int({error: LIMIT_MESSAGE})
    .min(1, {error: LIMIT_MESSAGE})
    .max(24, {error: LIMIT_MESSAGE})
    .optional()
    .default(4),
});

/** Reads depend on the request language (X-Locale / cookie): private, never `public`. */
const PRIVATE_SHORT = 'private, max-age=60';

/** Sitemap rows read at most (same cap as the template's sitemaps). */
export const SITEMAP_LIMIT = 1000;

/** Mounted at `/site-api/products` (src/server/app.ts). */
export const productRoutes = new Hono()
  .get('/sitemap', withDb, async c => {
    const rows = await c.var.db.product.findMany({
      where: {status: 'published'},
      select: {id: true, updatedAt: true},
      orderBy: [{position: 'asc'}, {id: 'asc'}],
      take: SITEMAP_LIMIT,
    });
    publicCache(c, 3600);
    const items: SitemapEntry[] = rows.map(r => ({
      path: `/product/${encodeURIComponent(r.id)}/`,
      updatedAt: r.updatedAt.toISOString(),
    }));
    return c.json({items});
  })
  .get('/:slug', withDb, withLocale, async c => {
    const slug = validSlug(c.req.param('slug'));
    if (!slug) throw notFound(MISSING);
    const db = c.var.db;
    const [row, loc] = await Promise.all([
      db.product.findFirst({where: {id: slug, status: 'published'}, select: productDetailSelect}),
      locOf(c),
    ]);
    if (!row) throw notFound(MISSING);
    const [{lowStockThreshold}, promos, ctr] = await Promise.all([
      getSettings(db),
      loadProductPromotions(db, undefined, loc),
      loadCatalogTr(db, loc, [row]),
    ]);
    // The English SEO overrides only apply to an untranslated page (VAREL html.ts: `translated ? null : seoTitle`).
    const translated = (ctr?.product.size ?? 0) > 0;
    const body: Product = {
      ...serializeProduct(row, lowStockThreshold, promos, loc, ctr),
      deptSlug: row.department.slug,
      categorySlug: row.category.slug,
      seoTitle: translated ? null : row.seoTitle || null,
      seoDescription: translated ? null : row.seoDescription || null,
    };
    c.header('Cache-Control', PRIVATE_SHORT);
    return c.json(body);
  })
  .get('/:slug/related', query(relatedQuery), withDb, withLocale, async c => {
    const slug = validSlug(c.req.param('slug'));
    if (!slug) throw notFound(MISSING);
    const {limit} = c.req.valid('query');
    // F4's bounded port of VAREL relatedProducts: same department or same category name first, then the rest,
    // in merchandising order; hideSoldOut applies here (not on the detail).
    const list: Product[] | null = await relatedProducts(c.var.db, slug, limit, await locOf(c));
    if (!list) throw notFound(MISSING);
    c.header('Cache-Control', PRIVATE_SHORT);
    return c.json(list);
  });
