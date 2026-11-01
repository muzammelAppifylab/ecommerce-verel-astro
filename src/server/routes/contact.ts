import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Contact form. WP-07 implements (docs/migration/PLAN.md §5).
 * Port of VAREL prisma ContactMessage (VAREL), src/pages/Contact.tsx: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   POST   /site-api/contact                           ContactInput → 204 (rate limited; staff alert via sendTemplate)
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/contact` (src/server/app.ts). */
export const contactRoutes = new Hono()
  .post('/', notImplemented);
