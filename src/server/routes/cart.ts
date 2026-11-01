import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Bag (cart), discounts at the bag, abandoned-bag recovery. WP-09 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/cart.ts, worker/routes/abandoned.ts, worker/lib/{cart,totals,discounts}.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/cart                              Cart (guest: visitor cookie; signed in: the account)
 *   GET    /site-api/cart/totals                       Totals ?country&method&email
 *   POST   /site-api/cart/items                        AddToCartInput → Cart (409 when over stock)
 *   PATCH  /site-api/cart/items/:lineId                {qty} → Cart (0 removes)
 *   DELETE /site-api/cart/items/:lineId                → Cart
 *   POST   /site-api/cart/discount                     {code} + DiscountContext → Cart; 422 discount_* codes
 *   DELETE /site-api/cart/discount                     → Cart
 *   POST   /site-api/cart/email                        CartEmailInput → 204 (abandoned-bag reminders)
 *   GET    /site-api/cart/recover/:token               restore an abandoned bag from its reminder link → Cart
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/cart` (src/server/app.ts). */
export const cartRoutes = new Hono()
  .get('/', notImplemented)
  .get('/totals', notImplemented)
  .post('/items', notImplemented)
  .patch('/items/:lineId', notImplemented)
  .delete('/items/:lineId', notImplemented)
  .post('/discount', notImplemented)
  .delete('/discount', notImplemented)
  .post('/email', notImplemented)
  .get('/recover/:token', notImplemented);
