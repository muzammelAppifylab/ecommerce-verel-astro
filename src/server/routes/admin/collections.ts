import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Collections and manual category order. WP-05 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/collections.ts: VAREL `/api/admin/collections…` is `/site-api/manage/collections…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/collections                AdminCollectionRow[]
 *   POST   /site-api/manage/collections                AdminCollectionInput → 201 AdminCollection
 *   PATCH  /site-api/manage/collections/order          {ids} → AdminCollectionRow[]
 *   GET    /site-api/manage/collections/category-order CategoryOrder ?category=
 *   PATCH  /site-api/manage/collections/product-order  VAREL PATCH /api/admin/products/order: {category, productIds} → CategoryOrder
 *   GET    /site-api/manage/collections/:id            AdminCollection
 *   PATCH  /site-api/manage/collections/:id            Partial<AdminCollectionInput> → AdminCollection
 *   DELETE /site-api/manage/collections/:id            204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products (reads: products or discounts); MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const collectionsAdmin = new Hono()
  .get('/', notImplemented)
  .post('/', notImplemented)
  .patch('/order', notImplemented)
  .get('/category-order', notImplemented)
  .patch('/product-order', notImplemented)
  .get('/:id', notImplemented)
  .patch('/:id', notImplemented)
  .delete('/:id', notImplemented);
