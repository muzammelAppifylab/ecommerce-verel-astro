import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Orders (customer). WP-14 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/orders.ts (orders part): VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/orders                            Order[] ?status=open|completed|returned (signed in)
 *   GET    /site-api/orders/:number                    Order: the owner, or a guest with ?email=
 *   POST   /site-api/orders/:number/cancel             CancelOrderInput → Order
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/orders` (src/server/app.ts). */
export const orderRoutes = new Hono()
  .get('/', notImplemented)
  .get('/:number', notImplemented)
  .post('/:number/cancel', notImplemented);
