import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Journal posts. WP-06 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/posts.ts: VAREL `/api/admin/posts…` is `/site-api/manage/posts…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/posts                      CursorPage<AdminPostRow> ?q&status&category&sort&cursor&pageSize
 *   POST   /site-api/manage/posts                      AdminPostInput → 201 AdminPost; 409 slug_taken
 *   GET    /site-api/manage/posts/:slug                AdminPost
 *   PATCH  /site-api/manage/posts/:slug                Partial<AdminPostInput> → AdminPost
 *   DELETE /site-api/manage/posts/:slug                204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: content; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const postsAdmin = new Hono()
  .get('/', notImplemented)
  .post('/', notImplemented)
  .get('/:slug', notImplemented)
  .patch('/:slug', notImplemented)
  .delete('/:slug', notImplemented);
