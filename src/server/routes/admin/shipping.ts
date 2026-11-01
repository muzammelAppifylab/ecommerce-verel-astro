import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Shipping zones and methods. WP-23 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/shipping.ts: VAREL `/api/admin/shipping…` is `/site-api/manage/shipping…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/shipping                   AdminShippingZone[]
 *   POST   /site-api/manage/shipping/zones             ZoneInput → 201 AdminShippingZone
 *   PATCH  /site-api/manage/shipping/zones/:id         Partial<ZoneInput> → AdminShippingZone; 409 last_catch_all
 *   DELETE /site-api/manage/shipping/zones/:id         204
 *   POST   /site-api/manage/shipping/zones/:id/methods MethodInput → 201 AdminShippingMethod
 *   PATCH  /site-api/manage/shipping/methods/:id       Partial<MethodInput> → AdminShippingMethod
 *   DELETE /site-api/manage/shipping/methods/:id       204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: settings (reads: any staff); MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const shippingAdmin = new Hono()
  .get('/', notImplemented)
  .post('/zones', notImplemented)
  .patch('/zones/:id', notImplemented)
  .delete('/zones/:id', notImplemented)
  .post('/zones/:id/methods', notImplemented)
  .patch('/methods/:id', notImplemented)
  .delete('/methods/:id', notImplemented);
