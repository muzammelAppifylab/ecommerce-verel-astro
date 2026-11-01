import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Activity log. WP-26 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/activity.ts: VAREL `/api/admin/activity…` is `/site-api/manage/activity…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/activity                   AdminActivityPage ?q&actor&entity&from&to&cursor&pageSize
 *   GET    /site-api/manage/activity/export.csv        CSV (VAREL /activity.csv)
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: staff; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const activityAdmin = new Hono()
  .get('/', notImplemented)
  .get('/export.csv', notImplemented);
