import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Product reviews (public). WP-04 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/reviews.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/products/:slug/reviews            ReviewsResponse ?page&pageSize&sort (src/lib/types/reviews.ts)
 *   GET    /site-api/products/:slug/reviews/eligibility ReviewEligibility for the signed-in visitor
 *   POST   /site-api/products/:slug/reviews            ReviewInput → 201 ReviewSubmitResponse (signed in, rate limited)
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/products` (src/server/app.ts). */
export const reviewRoutes = new Hono()
  .get('/:slug/reviews', notImplemented)
  .get('/:slug/reviews/eligibility', notImplemented)
  .post('/:slug/reviews', notImplemented);
