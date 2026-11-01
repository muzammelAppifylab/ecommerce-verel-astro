/* Image uploads (WP-17): the grant request and the storage refusal statuses. No database. */
import {describe, expect, it} from 'vitest';

import {grantSchema, MAX_UPLOAD_BYTES, storageStatus} from '../src/server/routes/admin/uploads';

const fieldsOf = (r: ReturnType<typeof grantSchema.safeParse>) =>
  Object.fromEntries((r.error?.issues ?? []).map(i => [i.path.join('.'), i.message]));

describe('upload grant', () => {
  it('accepts an image and strips any path from its name', () => {
    expect(grantSchema.parse({name: 'C:\\photos\\shirt.webp', contentType: 'image/webp', size: 1200})).toEqual({
      name: 'shirt.webp',
      contentType: 'image/webp',
      size: 1200,
    });
  });

  it('takes `type` as an alias of `contentType`', () => {
    expect(grantSchema.parse({name: 'a.png', type: 'IMAGE/PNG', size: 5}).contentType).toBe('image/png');
  });

  it('refuses other types, empty files and missing names', () => {
    expect(fieldsOf(grantSchema.safeParse({name: 'a.gif', contentType: 'image/gif', size: 5})).file).toBe('Upload a JPEG, PNG, WebP or AVIF image');
    expect(fieldsOf(grantSchema.safeParse({name: 'a.svg', contentType: 'image/svg+xml', size: 5})).file).toBeDefined();
    expect(fieldsOf(grantSchema.safeParse({name: 'a.jpg', contentType: 'image/jpeg', size: 0})).file).toBe('That file is empty');
    expect(fieldsOf(grantSchema.safeParse({name: '  ', contentType: 'image/jpeg', size: 4})).name).toBe('Choose an image to upload');
    expect(fieldsOf(grantSchema.safeParse({name: 'a.jpg', contentType: 'image/jpeg', size: 1.5})).size).toBe('Choose an image to upload');
  });

  it('leaves the size cap to the route (413)', () => {
    expect(grantSchema.safeParse({name: 'a.jpg', contentType: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1}).success).toBe(true);
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('storage refusals', () => {
  it('maps platform codes to statuses', () => {
    expect(storageStatus('E_STORAGE_NEEDS_PACK', 402)).toBe(402);
    expect(storageStatus('E_STORAGE_LIMIT', 403)).toBe(402);
    expect(storageStatus('E_STORAGE_OFF', 403)).toBe(503);
    expect(storageStatus('E_PLATFORM_UNREACHABLE', 0)).toBe(503);
    expect(storageStatus('E_FILE_TOO_LARGE', 413)).toBe(413);
    expect(storageStatus('E_WHATEVER', 422)).toBe(400);
  });
});
