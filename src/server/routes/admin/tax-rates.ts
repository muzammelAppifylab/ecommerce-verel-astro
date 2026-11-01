import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Tax rates. WP-23 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/tax-rates.ts: VAREL `/api/admin/tax-rates…` is `/site-api/manage/tax-rates…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/tax-rates                  AdminTaxRate[]
 *   POST   /site-api/manage/tax-rates                  TaxRateInput → 201 AdminTaxRate; 409 country_taken
 *   PATCH  /site-api/manage/tax-rates/:id              Partial<TaxRateInput> → AdminTaxRate
 *   DELETE /site-api/manage/tax-rates/:id              204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: settings (reads: any staff); MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const taxRatesAdmin = new Hono()
  .get('/', notImplemented)
  .post('/', notImplemented)
  .patch('/:id', notImplemented)
  .delete('/:id', notImplemented);
