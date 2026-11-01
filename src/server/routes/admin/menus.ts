import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Navigation menus. WP-07 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/menus.ts: VAREL `/api/admin/menus…` is `/site-api/manage/menus…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/menus                      AdminMenu[]
 *   PUT    /site-api/manage/menus/:key                 AdminMenuInput → AdminMenu
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: content; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const menusAdmin = new Hono()
  .get('/', notImplemented)
  .put('/:key', notImplemented);
