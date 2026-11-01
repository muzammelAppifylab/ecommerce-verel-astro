import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Staff. WP-26 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/staff.ts: VAREL `/api/admin/staff…` is `/site-api/manage/staff…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/staff                      AdminStaffList
 *   PATCH  /site-api/manage/staff/:id                  → AdminStaffMember
 *   DELETE /site-api/manage/staff/:id                  remove staff access → 204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: staff; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 * Staff are template users with roles (D5); role grants go through the template admin API
 * (`/site-api/admin/users/:id/roles`, anti-escalation built in).
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const staffAdmin = new Hono()
  .get('/', notImplemented)
  .patch('/:id', notImplemented)
  .delete('/:id', notImplemented);
