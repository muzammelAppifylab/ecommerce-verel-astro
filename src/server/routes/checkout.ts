import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Checkout (VAREL own payments, D3). WP-11 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/checkout.ts, worker/lib/payments/*: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/checkout/config                   CheckoutConfig
 *   POST   /site-api/checkout                          CheckoutRequest → 201 CheckoutResponse (402 declined, 409 total_changed, 422 discount_*)
 *   POST   /site-api/checkout/:number/sync             confirm a Stripe payment after the Payment Element → Order
 *   POST   /site-api/checkout/:number/cancel           abandon an unpaid Stripe order, restore the bag → 204
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/checkout` (src/server/app.ts). */
export const checkoutRoutes = new Hono()
  .get('/config', notImplemented)
  .post('/', notImplemented)
  .post('/:number/sync', notImplemented)
  .post('/:number/cancel', notImplemented);
