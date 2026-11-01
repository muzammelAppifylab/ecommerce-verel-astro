import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Discounts and promotions. WP-21 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/discount*.ts: VAREL `/api/admin/discounts…` is `/site-api/manage/discounts…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/discounts                  AdminDiscount[] ?q&method&status (≤ 100)
 *   POST   /site-api/manage/discounts                  AdminDiscountInput → 201 AdminDiscount; 409 code_taken
 *   GET    /site-api/manage/discounts/preview          DiscountPreview ?q=
 *   GET    /site-api/manage/discounts/names            {id, name}[] (pickers)
 *   GET    /site-api/manage/discounts/:id              AdminDiscount
 *   PATCH  /site-api/manage/discounts/:id              Partial<AdminDiscountInput> → AdminDiscount
 *   DELETE /site-api/manage/discounts/:id              204, or 200 {deactivated: true, discount} when used
 *   POST   /site-api/manage/discounts/:id/codes        GenerateCodesInput → 201 {created}
 *   GET    /site-api/manage/discounts/:id/codes        CursorPage<AdminDiscountCode> ?q&used&cursor&pageSize
 *   GET    /site-api/manage/discounts/:id/codes.csv    CSV of the codes
 *   DELETE /site-api/manage/discounts/:id/codes        delete the unused codes → {deleted}
 *   GET    /site-api/manage/discounts/:id/report       AdminDiscountReport
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: discounts; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const discountsAdmin = new Hono()
  .get('/', notImplemented)
  .post('/', notImplemented)
  .get('/preview', notImplemented)
  .get('/names', notImplemented)
  .get('/:id', notImplemented)
  .patch('/:id', notImplemented)
  .delete('/:id', notImplemented)
  .post('/:id/codes', notImplemented)
  .get('/:id/codes', notImplemented)
  .get('/:id/codes.csv', notImplemented)
  .delete('/:id/codes', notImplemented)
  .get('/:id/report', notImplemented);
