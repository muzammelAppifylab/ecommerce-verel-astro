import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: CMS pages. WP-07 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/pages.ts: VAREL `/api/admin/pages…` is `/site-api/manage/pages…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/pages                      AdminPage[]
 *   POST   /site-api/manage/pages                      AdminPageInput → 201 AdminPage
 *   GET    /site-api/manage/pages/:id                  AdminPage
 *   PATCH  /site-api/manage/pages/:id                  Partial<AdminPageInput> → AdminPage
 *   DELETE /site-api/manage/pages/:id                  204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: content; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const pagesAdmin = new Hono()
  .get('/', notImplemented)
  .post('/', notImplemented)
  .get('/:id', notImplemented)
  .patch('/:id', notImplemented)
  .delete('/:id', notImplemented);
