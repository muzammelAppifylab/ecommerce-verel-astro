import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * Image uploads (WP-17): `/site-api/manage/uploads`, against Postgres, with the platform's file API
 * (`/api/site/v1/files/*`) answered by a fake here.
 */
describe.skipIf(!DATABASE_URL)('image uploads (integration, real Postgres)', () => {
  let staff: Browser;
  let other: Browser;
  const FILE = 'file_0123456789abcdefghijklmnop';
  const platform = {
    off: false,
    stored: {contentType: 'image/webp', visibility: 'public'},
    calls: [] as string[],
  };
  const wrapped = globalThis.fetch;

  const file = (over: Record<string, unknown> = {}) => ({
    id: FILE,
    name: 'shirt.webp',
    contentType: 'image/webp',
    size: 1234,
    visibility: 'public',
    status: 'ready',
    environment: 'staging',
    createdAt: '2026-11-01T00:00:00.000Z',
    completedAt: '2026-11-01T00:00:01.000Z',
    ...over,
  });

  beforeAll(() => {
    configureEnv();
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const at = url.indexOf('/api/site/v1/files');
      if (at < 0) return wrapped(input, init);
      const path = url.slice(at + '/api/site/v1/files'.length);
      platform.calls.push(path);
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
      if (platform.off) return json(403, {errors: [{code: 'E_STORAGE_OFF', message: 'File storage is turned off for this site.'}]});
      if (path === '/uploads')
        return json(201, {data: {file: file({status: 'pending'}), upload: {method: 'PUT', url: 'https://storage.example.test/put', headers: {}, expiresAt: '2026-11-01T01:00:00.000Z'}}});
      if (path === `/${FILE}/complete`) return json(200, {data: {file: file(platform.stored)}});
      if (path === `/${FILE}/delete`) return json(200, {data: {deleted: true}});
      return json(404, {errors: [{code: 'E_NOT_FOUND', message: 'Not found'}]});
    };
  });
  afterAll(async () => {
    globalThis.fetch = wrapped;
    await db.$disconnect();
  });
  beforeAll(async () => {
    await resetDatabase();
    const owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.32');
    other = await signedIn(app, 'other@example.test', undefined, '203.0.113.33');
    for (const email of ['staff@example.test', 'other@example.test']) {
      const id = await userId(email);
      expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    }
  }, 180_000);
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "media_uploads" RESTART IDENTITY');
    platform.off = false;
    platform.stored = {contentType: 'image/webp', visibility: 'public'};
    platform.calls.length = 0;
  });

  const grant = () => staff.request('POST', '/site-api/manage/uploads', {name: 'shirt.webp', contentType: 'image/webp', size: 1234});

  it('grants an upload and keeps the file id', async () => {
    const res = await grant();
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json).toMatchObject({fileId: FILE, upload: {method: 'PUT'}});
    const row = await db.mediaUpload.findUnique({where: {fileId: FILE}});
    expect(row).toMatchObject({name: 'shirt.webp', ready: false, uploadedBy: await userId('staff@example.test')});
  });

  it('refuses bad requests before the platform', async () => {
    expect((await staff.request('POST', '/site-api/manage/uploads', {name: 'a.gif', contentType: 'image/gif', size: 4})).status).toBe(422);
    const big = await staff.request('POST', '/site-api/manage/uploads', {name: 'a.jpg', contentType: 'image/jpeg', size: 8 * 1024 * 1024 + 1});
    expect(big.status).toBe(413);
    expect(big.json.fields).toHaveProperty('file');
    expect(platform.calls).toEqual([]);
  });

  it('passes on the platform message when storage is off', async () => {
    platform.off = true;
    const res = await grant();
    expect(res.status).toBe(503);
    expect(res.json.message).toBe('File storage is turned off for this site.');
  });

  it('completes once, answers again the same, and only for the uploader', async () => {
    await grant();
    expect((await other.request('POST', `/site-api/manage/uploads/${FILE}/complete`)).status).toBe(404);
    expect((await staff.request('POST', '/site-api/manage/uploads/not-a-file/complete')).status).toBe(404);
    const done = await staff.request('POST', `/site-api/manage/uploads/${FILE}/complete`);
    expect(done.status, JSON.stringify(done.json)).toBe(201);
    expect(done.json).toEqual({id: FILE, fileId: FILE, url: `/__platform/files/${FILE}/shirt.webp`, contentType: 'image/webp', size: 1234});
    expect((await db.mediaUpload.findUnique({where: {fileId: FILE}}))?.ready).toBe(true);
    const calls = platform.calls.length;
    const again = await staff.request('POST', `/site-api/manage/uploads/${FILE}/complete`);
    expect(again.json).toEqual(done.json);
    expect(platform.calls.length).toBe(calls);
  });

  it('deletes a stored file that is not an image', async () => {
    await grant();
    platform.stored = {contentType: 'application/pdf', visibility: 'public'};
    const res = await staff.request('POST', `/site-api/manage/uploads/${FILE}/complete`);
    expect(res.status).toBe(422);
    expect(res.json.fields).toEqual({file: 'That file does not look like an image'});
    expect(platform.calls).toContain(`/${FILE}/delete`);
    expect(await db.mediaUpload.count()).toBe(0);
  });
});
