import {Hono} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import {z} from 'zod';

import type {UploadResult} from '../../../lib/types/admin/catalog';
import {SiteKeyMissing} from '../../../platform/api';
import {completeUpload, createUpload, deleteFile, publicFileUrl} from '../../../platform/files';
import {withDb} from '../../../platform/guards';
import type {Viewer} from '../../../platform/types';
import {HttpError, invalid} from '../../lib/errors';
import {apiError} from '../../lib/http';
import {json, params} from '../../lib/validate';
import {FILE_ID_RE} from './products-shared';

/**
 * Admin: Image uploads (platform files, D8). WP-17 (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/products.ts (POST /uploads): VAREL `/api/admin/uploads…` is `/site-api/manage/uploads…` here.
 *
 *   POST   /site-api/manage/uploads                    {name, contentType (or type), size} → 201 {fileId, upload}
 *   POST   /site-api/manage/uploads/:id/complete       → 201 UploadResult & {fileId}
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products, content or settings; MANAGE_AREAS in src/server/permissions.ts), then the activity log.
 * Images are stored as PUBLIC platform files (docs/agent/files.md): `createUpload` → the browser
 * `putFile`s the pre-sized image (the kit's `uploadImage`, src/portal/ui/image-uploader.tsx) →
 * `completeUpload`; the image is linked with `publicFileUrl`. The file id is kept in
 * `media_uploads`: product images (and any other record) may link a platform file only when its row
 * here is ready (`assertUploads` in ./products-shared.ts).
 *
 * VAREL received the bytes (multipart, 8 MB, magic-byte sniff) and wrote them to R2. Here the bytes
 * never reach the Worker: the type and size are checked on the grant, and the stored file's type is
 * checked again on complete (anything else is deleted).
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

/** The grant request. `type` is accepted as an alias of `contentType` (VAREL / F3 comment). */
export const grantSchema = z
  .object({
    name: z
      .string({error: 'Choose an image to upload'})
      .transform(s => s.trim().split(/[\\/]/).pop()?.trim() ?? '')
      .pipe(z.string().min(1, 'Choose an image to upload').max(200, 'Keep the file name under 200 characters')),
    contentType: z.string().trim().toLowerCase().optional(),
    type: z.string().trim().toLowerCase().optional(),
    size: z.coerce.number({error: 'Choose an image to upload'}).int('Choose an image to upload').min(0, 'That file is empty'),
  })
  .transform(v => ({name: v.name, contentType: v.contentType || v.type || '', size: v.size}))
  .superRefine((v, ctx) => {
    if (!(UPLOAD_IMAGE_TYPES as readonly string[]).includes(v.contentType)) {
      ctx.addIssue({code: 'custom', path: ['file'], message: 'Upload a JPEG, PNG, WebP or AVIF image'});
    } else if (v.size === 0) {
      ctx.addIssue({code: 'custom', path: ['file'], message: 'That file is empty'});
    }
  });

const fileParam = z.object({id: z.string().trim().max(64)});

/** The status a storage refusal answers with (402 for the owner's plan, 503 when storage is off or away). */
export function storageStatus(code: string, status: number): ContentfulStatusCode {
  if (code === 'E_STORAGE_NEEDS_PACK' || code === 'E_STORAGE_LIMIT') return 402;
  if (code === 'E_STORAGE_OFF' || code === 'E_STORAGE_UNAVAILABLE' || code === 'E_PLATFORM_UNREACHABLE') return 503;
  if (status === 413) return 413;
  return 400;
}

const NOT_SET_UP = 'File storage is not set up here yet';

export const uploadsAdmin = new Hono<{Variables: {viewer: Viewer}}>()
  .post('/', json(grantSchema), withDb, async c => {
    const input = c.req.valid('json');
    if (input.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, 'TOO_LARGE', 'Images can be up to 8 MB', {file: 'Images can be up to 8 MB'});
    }
    let grant;
    try {
      grant = await createUpload(c.req.url, {...input, visibility: 'public'});
    } catch (e) {
      if (e instanceof SiteKeyMissing) return apiError(c, 503, 'storage_unavailable', NOT_SET_UP);
      throw e;
    }
    if (!grant.ok) return apiError(c, storageStatus(grant.code, grant.status), grant.code, grant.message);
    await c.var.db.mediaUpload.create({
      data: {
        fileId: grant.data.file.id,
        name: input.name,
        contentType: input.contentType,
        size: input.size,
        uploadedBy: c.var.viewer?.id ?? null,
      },
      select: {id: true},
    });
    c.header('Cache-Control', 'private, no-store');
    return c.json({fileId: grant.data.file.id, upload: grant.data.upload}, 201);
  })

  .post('/:id/complete', params(fileParam), withDb, async c => {
    const fileId = c.req.valid('param').id;
    const db = c.var.db;
    const missing = () => apiError(c, 404, 'not_found', 'We cannot find that upload');
    if (!FILE_ID_RE.test(fileId)) return missing();
    const row = await db.mediaUpload.findUnique({
      where: {fileId},
      select: {id: true, uploadedBy: true, ready: true, url: true, contentType: true, size: true},
    });
    if (!row || row.uploadedBy !== (c.var.viewer?.id ?? null)) return missing();
    c.header('Cache-Control', 'private, no-store');
    // Already confirmed (a retried request): the same answer again.
    if (row.ready && row.url) {
      const done: UploadResult & {fileId: string} = {id: fileId, fileId, url: row.url, contentType: row.contentType, size: row.size};
      return c.json(done, 201);
    }

    let res;
    try {
      res = await completeUpload(c.req.url, fileId);
    } catch (e) {
      if (e instanceof SiteKeyMissing) return apiError(c, 503, 'storage_unavailable', NOT_SET_UP);
      throw e;
    }
    if (!res.ok) return apiError(c, storageStatus(res.code, res.status), res.code, res.message);
    const file = res.data;
    if (file.visibility !== 'public' || !(UPLOAD_IMAGE_TYPES as readonly string[]).includes(file.contentType)) {
      await deleteFile(c.req.url, fileId).catch(() => undefined);
      await db.mediaUpload.delete({where: {id: row.id}});
      throw invalid({file: 'That file does not look like an image'});
    }
    const url = publicFileUrl(file);
    await db.mediaUpload.update({where: {id: row.id}, data: {ready: true, url, size: file.size, contentType: file.contentType}});
    const done: UploadResult & {fileId: string} = {id: fileId, fileId, url, contentType: file.contentType, size: file.size};
    return c.json(done, 201);
  });
