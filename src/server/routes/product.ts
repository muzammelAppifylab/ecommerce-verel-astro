import {Hono} from 'hono';

import type {SitemapEntry} from '../../lib/types/common';
import {notImplemented} from '../lib/http';

/**
 * Product detail. WP-03 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/catalog.ts (GET /products/:slug, /:slug/related), worker/routes/html.ts (sitemap): VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/products/sitemap                  SitemapResponse: `/product/<slug>/` of published products, ≤ 1000, for /sitemap.xml
 *   GET    /site-api/products/:slug                    Product; 404 unless published
 *   GET    /site-api/products/:slug/related            Product[] ?limit=4 (same dept or category first)
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/products` (src/server/app.ts). */
export const productRoutes = new Hono()
  .get('/sitemap', c => c.json({items: [] as SitemapEntry[]}))
  .get('/:slug', notImplemented)
  .get('/:slug/related', notImplemented);
