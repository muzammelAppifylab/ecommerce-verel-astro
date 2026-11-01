import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Returns (customer). WP-14 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/orders.ts (returns part): VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   POST   /site-api/returns/lookup                    ReturnLookupInput → ReturnLookupResponse (rate limited)
 *   POST   /site-api/returns                           CreateReturnInput → 201 CreateReturnResponse
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/returns` (src/server/app.ts). */
export const returnRoutes = new Hono()
  .post('/lookup', notImplemented)
  .post('/', notImplemented);
