import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Customers. WP-20 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/customers.ts: VAREL `/api/admin/customers…` is `/site-api/manage/customers…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/customers                  CursorPage<AdminCustomerRow> ?q&role&sort&cursor&pageSize
 *   GET    /site-api/manage/customers/:id              AdminCustomer
 *   PATCH  /site-api/manage/customers/:id              profile fields → AdminCustomer (roles change in the template Users screen)
 *   GET    /site-api/manage/customers/:id/export       CustomerExport (attachment)
 *   DELETE /site-api/manage/customers/:id              anonymise → 204; 409 not_a_customer, already_deleted
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: customers; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const customersAdmin = new Hono()
  .get('/', notImplemented)
  .get('/:id', notImplemented)
  .patch('/:id', notImplemented)
  .get('/:id/export', notImplemented)
  .delete('/:id', notImplemented);
