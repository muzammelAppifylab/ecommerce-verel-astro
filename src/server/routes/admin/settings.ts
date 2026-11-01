import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Store settings. WP-23 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/settings.ts: VAREL `/api/admin/settings…` is `/site-api/manage/settings…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/settings                   StoreSettings (secrets: booleans from config.ownerSecret)
 *   PATCH  /site-api/manage/settings                   StoreSettingsInput → StoreSettings
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: settings (reads: any staff); MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const settingsAdmin = new Hono()
  .get('/', notImplemented)
  .patch('/', notImplemented);
