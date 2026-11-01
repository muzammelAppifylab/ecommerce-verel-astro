import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Review moderation. WP-04 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/reviews.ts: VAREL `/api/admin/reviews…` is `/site-api/manage/reviews…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/reviews                    AdminReviewList ?status&rating&q&cursor&pageSize
 *   POST   /site-api/manage/reviews/bulk               AdminReviewBulk → {updated}
 *   PATCH  /site-api/manage/reviews/:id                AdminReviewUpdate → AdminReview
 *   DELETE /site-api/manage/reviews/:id                204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const reviewsAdmin = new Hono()
  .get('/', notImplemented)
  .post('/bulk', notImplemented)
  .patch('/:id', notImplemented)
  .delete('/:id', notImplemented);
