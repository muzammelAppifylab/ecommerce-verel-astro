import {Hono} from 'hono';

import type {FeedItem} from '../../lib/types/content';
import type {SitemapEntry} from '../../lib/types/common';
import {notImplemented} from '../lib/http';

/**
 * Journal (public). WP-06 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/posts.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/posts                             Post[] ?category= newest first (published, publishedAt ≤ now)
 *   GET    /site-api/posts/categories                  PostCategory[]
 *   GET    /site-api/posts/sitemap                     SitemapResponse: `/journal/<slug>/` of published posts
 *   GET    /site-api/posts/feed                        FeedResponse: the 20 newest published posts for /rss.xml
 *   GET    /site-api/posts/:slug                       PostDetail; 404 unless published
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/posts` (src/server/app.ts). */
export const postRoutes = new Hono()
  .get('/', notImplemented)
  .get('/categories', notImplemented)
  .get('/sitemap', c => c.json({items: [] as SitemapEntry[]}))
  .get('/feed', c => c.json({items: [] as FeedItem[]}))
  .get('/:slug', notImplemented);
