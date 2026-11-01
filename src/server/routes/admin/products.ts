import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Products. WP-17 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/products.ts (products part): VAREL `/api/admin/products…` is `/site-api/manage/products…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/products                   CursorPage<AdminProductRow> ?q&status&dept&category&stock&sort&cursor&pageSize
 *   POST   /site-api/manage/products                   AdminProductInput → 201 AdminProduct (409 slug_taken, sku_taken)
 *   GET    /site-api/manage/products/:id               AdminProduct
 *   PATCH  /site-api/manage/products/:id               Partial<AdminProductInput> → AdminProduct
 *   DELETE /site-api/manage/products/:id               204, or 200 {archived: true} when it was ordered
 *   POST   /site-api/manage/products/:id/duplicate     201 AdminProduct (draft copy)
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products (reads: products or discounts); MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const productsAdmin = new Hono()
  .get('/', notImplemented)
  .post('/', notImplemented)
  .get('/:id', notImplemented)
  .patch('/:id', notImplemented)
  .delete('/:id', notImplemented)
  .post('/:id/duplicate', notImplemented);
