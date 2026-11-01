import {Hono} from 'hono';

import {notImplemented} from '../../lib/http';

/**
 * Admin: Image uploads (platform files, D8). WP-17 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/products.ts (POST /uploads): VAREL `/api/admin/uploads…` is `/site-api/manage/uploads…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   POST   /site-api/manage/uploads                    {name, type, size} → upload grant (image/jpeg, png, webp, avif; ≤ 8 MB)
 *   POST   /site-api/manage/uploads/:id/complete       → 201 UploadResult
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products, content or settings; MANAGE_AREAS in src/server/permissions.ts), then the activity log. Handlers add
 * their validator and `withDb`; field-level rules use `can(c, PERMISSIONS.X)`.
 * Images are stored as PUBLIC platform files (docs/agent/files.md): `createUpload` → the browser
 * `putFile`s the pre-sized image → `completeUpload`; the image is linked with `publicFileUrl`.
 *
 * Wave 0 stub: every route answers 501 `not_implemented`. Replace each handler IN PLACE, keeping the
 * method and path. This module's prefix is its own, so `.use('*', …)` here is scoped to it.
 * Static paths stay before `/:param` ones.
 */
export const uploadsAdmin = new Hono()
  .post('/', notImplemented)
  .post('/:id/complete', notImplemented);
