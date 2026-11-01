import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Orders. WP-19 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/orders.ts (orders part): VAREL `/api/admin/orders…` is `/site-api/manage/orders…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/orders                     CursorPage<AdminOrderRow> ?q&payment&fulfillment&from&to&sort&cursor&pageSize
 *   GET    /site-api/manage/orders/export.csv          CSV, same filters (VAREL /orders.csv)
 *   GET    /site-api/manage/orders/:number             AdminOrder
 *   PATCH  /site-api/manage/orders/:number             AdminOrderUpdate → AdminOrder
 *   POST   /site-api/manage/orders/:number/refund      RefundInput → AdminOrder (refundOrder / restockOrder contracts); 409 already_refunded
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: orders; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const ordersAdmin = new Hono()
  .get('/', notImplemented)
  .get('/export.csv', notImplemented)
  .get('/:number', notImplemented)
  .patch('/:number', notImplemented)
  .post('/:number/refund', notImplemented);
