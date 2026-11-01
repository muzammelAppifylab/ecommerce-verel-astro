import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Returns. WP-19 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/orders.ts (returns part): VAREL `/api/admin/returns…` is `/site-api/manage/returns…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/returns                    CursorPage<AdminReturnRow> ?q&status&cursor&pageSize
 *   GET    /site-api/manage/returns/:id                AdminReturn
 *   PATCH  /site-api/manage/returns/:id                ReturnUpdate → AdminReturn; 409 return_closed
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: orders; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const returnsAdmin = new Hono()
  .get('/', notImplemented)
  .get('/:id', notImplemented)
  .patch('/:id', notImplemented);
