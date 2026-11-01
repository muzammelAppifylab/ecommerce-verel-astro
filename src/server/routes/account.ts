import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Customer account. WP-13 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/account.ts, worker/lib/privacy.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/account/overview                  AccountOverview
 *   PATCH  /site-api/account/profile                   ProfileInput → {user: AccountUser}
 *   PATCH  /site-api/account/preferences               PreferencesInput → {user: AccountUser}
 *   GET    /site-api/account/addresses                 Address[]
 *   POST   /site-api/account/addresses                 AddressInput → 201 Address
 *   PATCH  /site-api/account/addresses/:id             Partial<AddressInput> → Address
 *   DELETE /site-api/account/addresses/:id             204
 *   GET    /site-api/account/export                    CustomerExport (attachment)
 *   POST   /site-api/account/delete                    anonymise the customer data (lib/privacy.ts), then the template deletes the account → 204
 *
 * Signed in only (`withViewer, requireAuth`). Password, email, sessions and deletion of the sign-in itself
 * are the template's (`/site-api/auth/*`, D5).
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/account` (src/server/app.ts). */
export const accountRoutes = new Hono()
  .get('/overview', notImplemented)
  .patch('/profile', notImplemented)
  .patch('/preferences', notImplemented)
  .get('/addresses', notImplemented)
  .post('/addresses', notImplemented)
  .patch('/addresses/:id', notImplemented)
  .delete('/addresses/:id', notImplemented)
  .get('/export', notImplemented)
  .post('/delete', notImplemented);
