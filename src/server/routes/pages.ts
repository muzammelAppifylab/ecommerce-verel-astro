import {Hono} from 'hono';

import type {SitemapEntry} from '../../lib/types/common';
import {notImplemented} from '../lib/http';

/**
 * CMS pages (public). WP-07 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/pages.ts (GET /pages/:slug): VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/pages/sitemap                     SitemapResponse: published pages (`privacy`, `terms` at `/privacy/`, `/terms/`; others `/pages/<slug>/`)
 *   GET    /site-api/pages/:slug                       CmsPage; 404 unless published
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/pages` (src/server/app.ts). */
export const pageRoutes = new Hono()
  .get('/sitemap', c => c.json({items: [] as SitemapEntry[]}))
  .get('/:slug', notImplemented);
