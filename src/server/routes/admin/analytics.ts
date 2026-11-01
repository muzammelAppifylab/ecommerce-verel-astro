import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Analytics. WP-16 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/analytics.ts: VAREL `/api/admin/analytics…` is `/site-api/manage/analytics…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/analytics                  AdminAnalytics ?days&from&to
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: analytics; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const analyticsAdmin = new Hono()
  .get('/', notImplemented);
