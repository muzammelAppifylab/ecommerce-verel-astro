import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Storefront i18n. WP-15 (PATCH /account/locale, POST /account/onboarding), WP-25 (catalogs) implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/i18n.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/i18n/catalog/:locale/:ns          I18nCatalogResponse (src/lib/types/events.ts)
 *   PATCH  /site-api/account/locale                    LocaleInput → {locale} (remember the language; sets the locale cookie; VAREL 200)
 *   POST   /site-api/account/onboarding                after the first sign-in: CustomerProfile, sign-up extras, guest merge → OnboardingResult (WP-15)
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/i18n` (src/server/app.ts). */
export const i18nRoutes = new Hono()
  .get('/catalog/:locale/:ns', notImplemented);

/** Mounted at `/site-api/account` (src/server/app.ts). */
export const accountLocaleRoutes = new Hono()
  .patch('/locale', notImplemented)
  .post('/onboarding', notImplemented);
