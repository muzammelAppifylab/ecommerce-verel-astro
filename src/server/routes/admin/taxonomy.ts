import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Departments and categories. WP-18 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/taxonomy.ts: VAREL `/api/admin/<departments|categories>…` is `/site-api/manage/taxonomy…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/taxonomy/departments       AdminDepartment[]
 *   POST   /site-api/manage/taxonomy/departments       {name, position?} → 201 AdminDepartment
 *   PATCH  /site-api/manage/taxonomy/departments/:id   {name?, position?} → AdminDepartment
 *   DELETE /site-api/manage/taxonomy/departments/:id   204; 409 in_use
 *   POST   /site-api/manage/taxonomy/departments/:id/categories {name, position?} → 201 AdminCategory
 *   PATCH  /site-api/manage/taxonomy/categories/:id    {name?, position?} → AdminCategory
 *   DELETE /site-api/manage/taxonomy/categories/:id    204; 409 in_use
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products (reads: any staff); MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const taxonomyAdmin = new Hono()
  .get('/departments', notImplemented)
  .post('/departments', notImplemented)
  .patch('/departments/:id', notImplemented)
  .delete('/departments/:id', notImplemented)
  .post('/departments/:id/categories', notImplemented)
  .patch('/categories/:id', notImplemented)
  .delete('/categories/:id', notImplemented);
