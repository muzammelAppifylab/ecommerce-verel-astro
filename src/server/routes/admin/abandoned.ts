import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Abandoned bags. WP-24 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/abandoned.ts, worker/lib/abandoned.ts: VAREL `/api/admin/abandoned…` is `/site-api/manage/abandoned…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/abandoned                  AbandonedList ?q&status&sort&cursor&pageSize
 *   POST   /site-api/manage/abandoned/run              AbandonedRunResult ("Check now": same work as the abandoned-carts job)
 *   POST   /site-api/manage/abandoned/bulk             {ids, action} → AbandonedBulkResult
 *   POST   /site-api/manage/abandoned/:id/remind       → AbandonedBagRow
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: orders; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const abandonedAdmin = new Hono()
  .get('/', notImplemented)
  .post('/run', notImplemented)
  .post('/bulk', notImplemented)
  .post('/:id/remind', notImplemented);
