import {Hono} from 'hono';

import type {SitemapEntry} from '../../lib/types/common';
import {notImplemented} from '../lib/http';

/**
 * Catalog listing: taxonomy and product lists. WP-02 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/catalog.ts (/taxonomy, GET /products), worker/lib/catalog.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/taxonomy                          Department[] with categories and published product counts (src/lib/types/catalog.ts)
 *   GET    /site-api/taxonomy/sitemap                  SitemapResponse: /shop/, /shop/<dept>/, /shop/<dept>/<cat>/ (VAREL html.ts sitemap)
 *   GET    /site-api/products                          ProductListResponse ?dept&category&q&color&size&material&brand&maxPrice&tag&sort&limit&featured
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/taxonomy` (src/server/app.ts). */
export const taxonomyRoutes = new Hono()
  .get('/', notImplemented)
  .get('/sitemap', c => c.json({items: [] as SitemapEntry[]}));

/** Mounted at `/site-api/products` (src/server/app.ts). */
export const catalogRoutes = new Hono()
  .get('/', notImplemented);
