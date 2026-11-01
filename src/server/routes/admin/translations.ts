import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Content translations. WP-25 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/translations.ts: VAREL `/api/admin/translations…` is `/site-api/manage/translations…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/translations               TranslationList ?entity&locale&status&q&cursor&pageSize
 *   GET    /site-api/manage/translations/status        TranslationsStatus
 *   POST   /site-api/manage/translations/retranslate   TranslationTarget → TranslateMissingResult
 *   POST   /site-api/manage/translations/translate-missing {locale?, entity?} → TranslateMissingResult
 *   GET    /site-api/manage/translations/:entity/:id   EntityTranslations
 *   PUT    /site-api/manage/translations/:entity/:id   EntityTranslationsInput → EntityTranslations
 *   DELETE /site-api/manage/translations/:entity/:id   204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: content; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const translationsAdmin = new Hono()
  .get('/', notImplemented)
  .get('/status', notImplemented)
  .post('/retranslate', notImplemented)
  .post('/translate-missing', notImplemented)
  .get('/:entity/:id', notImplemented)
  .put('/:entity/:id', notImplemented)
  .delete('/:entity/:id', notImplemented);
