import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const files = vi.hoisted(() => ({status: 200 as number}));
vi.mock('../../src/platform/files', async importOriginal => {
  const mod = await importOriginal<typeof import('../../src/platform/files')>();
  return {
    ...mod,
    fileUrl: vi.fn(async (_url: string, id: string) =>
      files.status === 200
        ? {ok: true, status: 200, data: {url: `https://files.example.test/${id}?sig=1`, expiresAt: '2030-01-01T00:00:00.000Z'}}
        : {ok: false, status: files.status, error: 'storage', message: 'storage says no'}
    ),
  };
});

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

const FILE = 'file_0123456789abcdefghijklmnop';

async function order(number: string, email: string, opts: {userId?: number; payment?: string; download?: string} = {}) {
  await db.shopOrder.create({
    data: {
      number,
      email,
      userId: opts.userId ?? null,
      payment: opts.payment ?? 'Paid',
      method: 'Digital',
      subtotalCents: 1500,
      totalCents: 1500,
      items: {
        create: [
          {name: 'Care guide', category: 'Guides', sku: number, qty: 1, priceCents: 1500, image: {}, digital: true, download: opts.download ?? FILE},
        ],
      },
    },
    select: {id: true},
  });
}

/** GET /site-api/downloads/:file (src/server/routes/downloads.ts), against Postgres; platform files mocked. */
describe.skipIf(!DATABASE_URL)('digital downloads (integration, real Postgres)', () => {
  let mira: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    files.status = 200;
    await signedIn(app, 'owner@example.test', undefined, '203.0.113.40');
    mira = await signedIn(app, 'mira@example.test', undefined, '203.0.113.41');
  });

  it('the owner of a paid order gets a short-lived link (302 or JSON)', async () => {
    await order('VRL-24817', 'mira@example.test', {userId: await userId('mira@example.test')});
    const redirect = await mira.get(`/site-api/downloads/${FILE}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(`https://files.example.test/${FILE}?sig=1`);
    expect(redirect.headers.get('cache-control')).toBe('private, no-store');
    expect(redirect.headers.get('referrer-policy')).toBe('no-referrer');
    const json = await mira.get(`/site-api/downloads/${FILE}?format=json`);
    expect(json.status).toBe(200);
    expect(json.json).toEqual({url: `https://files.example.test/${FILE}?sig=1`, expiresAt: '2030-01-01T00:00:00.000Z'});
  });

  it('a guest order with the account email counts; pending orders and other people do not', async () => {
    await order('VRL-24818', 'MIRA@example.test');
    expect((await mira.get(`/site-api/downloads/${FILE}?format=json`)).status).toBe(200);
    await resetDatabase();
    await signedIn(app, 'owner@example.test', undefined, '203.0.113.40');
    mira = await signedIn(app, 'mira@example.test', undefined, '203.0.113.41');
    await order('VRL-24819', 'mira@example.test', {payment: 'Pending', userId: await userId('mira@example.test')});
    expect((await mira.get(`/site-api/downloads/${FILE}`)).status).toBe(403);
    const other = await signedIn(app, 'other@example.test', undefined, '203.0.113.42');
    const res = await other.get(`/site-api/downloads/${FILE}`);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('download_forbidden');
  });

  it('guests with the order number and email', async () => {
    await order('VRL-24817', 'mira@example.test');
    const guest = new Browser(app, '203.0.113.43');
    expect((await guest.get(`/site-api/downloads/${FILE}?order=24817&email=MIRA@example.test`)).status).toBe(302);
    expect((await guest.get(`/site-api/downloads/${FILE}?order=vrl24817&email=mira@example.test`)).status).toBe(302);
    expect((await guest.get(`/site-api/downloads/${FILE}?order=24817&email=someone@example.test`)).status).toBe(403);
    expect((await guest.get(`/site-api/downloads/${FILE}`)).status).toBe(403);
  });

  it('unsafe names, legacy names and storage failures', async () => {
    await order('VRL-24817', 'mira@example.test', {download: 'varel-care-guide.pdf'});
    await order('VRL-24820', 'mira@example.test');
    expect((await mira.get('/site-api/downloads/.env')).status).toBe(404);
    const legacy = await mira.get('/site-api/downloads/varel-care-guide.pdf');
    expect(legacy.status).toBe(404);
    expect(legacy.json.error).toBe('download_unavailable');
    files.status = 500;
    const down = await mira.get(`/site-api/downloads/${FILE}`);
    expect(down.status).toBe(503);
    expect(down.headers.get('cache-control')).toBe('private, no-store');
    files.status = 404;
    expect((await mira.get(`/site-api/downloads/${FILE}`)).status).toBe(404);
  });
});
