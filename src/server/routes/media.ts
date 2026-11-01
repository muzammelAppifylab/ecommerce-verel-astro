import {Hono} from 'hono';

import {apiError} from '../lib/http';

/**
 * Public media (VAREL worker/routes/media.ts, `GET /api/media/:key`).
 *
 *   GET /site-api/media/:key   404 `not_found`
 *
 * VAREL served admin-uploaded images from its R2 `MEDIA` bucket here. In this app images are PUBLIC
 * platform files (D8, docs/agent/files.md): their stable link comes from `publicFileUrl(file)` and is
 * stored with the image, so nothing is served through this route. It stays so an old `/api/media/…`
 * link (rewritten to `/site-api/media/…`) answers VAREL's "cannot find that image" instead of the
 * generic not-found, without touching the database.
 */
export const mediaRoutes = new Hono().get('/:key{.+}', c => apiError(c, 404, 'not_found', 'We cannot find that image'));
