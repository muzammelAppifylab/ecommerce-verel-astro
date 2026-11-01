import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Overview. WP-16 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/dashboard.ts: VAREL `/api/admin/dashboard…` is `/site-api/manage/dashboard…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/dashboard                  AdminDashboard ?days=7|30|90|all
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: any staff; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const dashboardAdmin = new Hono()
  .get('/', notImplemented);
