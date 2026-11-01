import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Shipping zones, methods and countries (public). WP-11 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/shipping.ts, worker/lib/{shipping,countries}.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/shipping/zones                    ShippingZonesResponse
 *   GET    /site-api/shipping/methods                  ShippingMethodsResponse ?country=
 *   GET    /site-api/countries                         string[]: the countries the store ships to
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/shipping` (src/server/app.ts). */
export const shippingRoutes = new Hono()
  .get('/zones', notImplemented)
  .get('/methods', notImplemented);

/** Mounted at `/site-api/countries` (src/server/app.ts). */
export const countryRoutes = new Hono()
  .get('/', notImplemented);
