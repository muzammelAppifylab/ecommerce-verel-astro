import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Inventory. WP-18 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/products.ts (inventory part): VAREL `/api/admin/inventory…` is `/site-api/manage/inventory…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/inventory                  CursorPage<InventoryRow> ?q&state&cursor&pageSize
 *   POST   /site-api/manage/inventory/bulk             {updates: {variantId, inventory}[]} → {updated}
 *   PATCH  /site-api/manage/inventory/:variantId       {inventory} | {adjust} → InventoryRow
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const inventoryAdmin = new Hono()
  .get('/', notImplemented)
  .post('/bulk', notImplemented)
  .patch('/:variantId', notImplemented);
