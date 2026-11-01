import {Hono} from 'hono';

import type {SitemapEntry} from '../../lib/types/common';
import {notImplemented} from '../lib/http';

/**
 * Collections (public). WP-05 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/collections.ts, worker/lib/collections.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/collections                       CollectionSummary[] ?featured=true (src/lib/types/collections.ts)
 *   GET    /site-api/collections/sitemap               SitemapResponse: `/collections/<slug>/` of published collections
 *   GET    /site-api/collections/:slug                 CollectionDetail; 404 unless published
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/collections` (src/server/app.ts). */
export const collectionRoutes = new Hono()
  .get('/', notImplemented)
  .get('/sitemap', c => c.json({items: [] as SitemapEntry[]}))
  .get('/:slug', notImplemented);
