import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Analytics beacon. WP-16 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/events.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   POST   /site-api/events                            EventBatch → 204 always (consent-gated in the browser)
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/events` (src/server/app.ts). */
export const eventRoutes = new Hono()
  .post('/', notImplemented);
