import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Navigation menus (public). WP-01 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/pages.ts (GET /menus): VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/menus                             Menu[] (src/lib/types/content.ts), localized
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/menus` (src/server/app.ts). */
export const menuRoutes = new Hono()
  .get('/', notImplemented);
