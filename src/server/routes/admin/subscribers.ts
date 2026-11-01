import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Newsletter subscribers. WP-20 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/subscribers.ts: VAREL `/api/admin/subscribers…` is `/site-api/manage/subscribers…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/subscribers                CursorPage<AdminSubscriber> ?q&cursor&pageSize
 *   GET    /site-api/manage/subscribers/export.csv     CSV (VAREL /subscribers.csv)
 *   DELETE /site-api/manage/subscribers/:email         204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: customers; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const subscribersAdmin = new Hono()
  .get('/', notImplemented)
  .get('/export.csv', notImplemented)
  .delete('/:email', notImplemented);
