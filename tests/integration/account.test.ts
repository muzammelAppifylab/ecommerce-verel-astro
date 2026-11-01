import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const sent = vi.hoisted(() => [] as {key: string; to: string; vars: Record<string, unknown>}[]);
vi.mock('../../src/server/lib/contracts', async importOriginal => {
  const mod = await importOriginal<typeof import('../../src/server/lib/contracts')>();
  return {
    ...mod,
    sendTemplate: vi.fn(async (_db: unknown, key: string, to: string, vars: Record<string, unknown>) => {
      sent.push({key, to, vars});
    }),
  };
});

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

let n = 0;
async function order(data: {email: string; userId?: number | null; payment?: string; placedAt?: Date; digital?: string; phone?: string}) {
  n += 1;
  return db.shopOrder.create({
    data: {
      number: `VRL-${String(30000 + n)}`,
      email: data.email,
      userId: data.userId ?? null,
      phone: data.phone ?? '+45 1234',
      payment: data.payment ?? 'Paid',
      method: 'Standard',
      subtotalCents: 10000,
      totalCents: 10000,
      currency: 'EUR',
      placedAt: data.placedAt ?? new Date(Date.now() - (100 - n) * 60_000),
      items: {
        create: [
          {
            name: data.digital ? 'Care guide' : 'Wool coat',
            category: 'Coats',
            sku: `SKU-${n}`,
            qty: 1,
            priceCents: 10000,
            image: {src: 'https://images.example/x.jpg'},
            digital: !!data.digital,
            download: data.digital ?? null,
          },
        ],
      },
    },
    select: {id: true, number: true},
  });
}

/** The customer account routes (src/server/routes/account.ts), against Postgres. */
describe.skipIf(!DATABASE_URL)('customer account (integration, real Postgres)', () => {
  let mira: Browser;
  let miraId: number;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    sent.length = 0;
    // The first account is the site's owner: customers come after it.
    await signedIn(app, 'owner@example.test', undefined, '203.0.113.30');
    mira = await signedIn(app, 'mira.halvorsen@example.test', undefined, '203.0.113.31');
    miraId = await userId('mira.halvorsen@example.test');
  });

  it('every route asks a guest to sign in', async () => {
    const guest = new Browser(app, '203.0.113.39');
    for (const [method, path] of [
      ['GET', '/site-api/account/overview'],
      ['PATCH', '/site-api/account/profile'],
      ['PATCH', '/site-api/account/preferences'],
      ['GET', '/site-api/account/addresses'],
      ['POST', '/site-api/account/addresses'],
      ['GET', '/site-api/account/export'],
    ] as const) {
      const body = method === 'GET' ? undefined : method === 'PATCH' && path.endsWith('profile') ? {firstName: 'A', lastName: 'B'} : method === 'PATCH' ? {newsletter: true} : {name: 'A', line1: 'B', city: 'C', zip: '1', country: 'Denmark'};
      const res = await guest.request(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('overview: names from users.name, newest three orders, guest orders with the same email, paid downloads', async () => {
    const other = await signedIn(app, 'someone@example.test', undefined, '203.0.113.32');
    void other;
    const otherId = await userId('someone@example.test');
    await order({email: 'mira.halvorsen@example.test', userId: miraId});
    await order({email: 'MIRA.HALVORSEN@example.test'}); // guest order, other case
    await order({email: 'someone@example.test', userId: otherId}); // never Mira's
    await order({email: 'mira.halvorsen@example.test', userId: miraId, digital: 'file_0123456789abcdefghijklmnop'});
    await order({email: 'mira.halvorsen@example.test', userId: miraId, payment: 'Pending', digital: 'file_zzzzzzzzzzzzzzzzzzzzzzzzzz'});

    const res = await mira.get('/site-api/account/overview');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = res.json as {
      user: {firstName: string; email: string; id: string};
      recentOrders: {number: string}[];
      orderCount: number;
      downloads: {file: string; orderNumber: string}[];
      wishlistCount: number;
      addresses: unknown[];
    };
    expect(body.user.email).toBe('mira.halvorsen@example.test');
    expect(body.user.firstName).toBe('mira.halvorsen');
    expect(body.user.id).toBe(String(miraId));
    expect(body.recentOrders).toHaveLength(3);
    expect(body.recentOrders.map(o => o.number)).toEqual(['VRL-30005', 'VRL-30004', 'VRL-30002']);
    expect(body.orderCount).toBe(4);
    expect(body.downloads).toEqual([{name: 'Care guide', file: 'file_0123456789abcdefghijklmnop', orderNumber: 'VRL-30004'}]);
    expect(body.wishlistCount).toBe(0);
    expect(body.addresses).toEqual([]);
  });

  it('profile saves the profile row and keeps users.name in step', async () => {
    const res = await mira.request('PATCH', '/site-api/account/profile', {firstName: ' Mira ', lastName: 'Halvorsen', phone: '', email: 'x@y.z'});
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({firstName: 'Mira', lastName: 'Halvorsen', phone: null, email: 'mira.halvorsen@example.test'});
    const user = await db.user.findUniqueOrThrow({where: {id: miraId}, select: {name: true, email: true}});
    expect(user).toEqual({name: 'Mira Halvorsen', email: 'mira.halvorsen@example.test'});
    const bad = await mira.request('PATCH', '/site-api/account/profile', {firstName: '', lastName: 'x'.repeat(81)});
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.json.fields as object)).toEqual(expect.arrayContaining(['firstName', 'lastName']));
  });

  it('preferences follow the newsletter list', async () => {
    const on = await mira.request('PATCH', '/site-api/account/preferences', {newsletter: true});
    expect(on.status).toBe(200);
    expect((on.json.user as {newsletter: boolean}).newsletter).toBe(true);
    expect(await db.newsletterSubscriber.findUnique({where: {email: 'mira.halvorsen@example.test'}, select: {source: true}})).toEqual({
      source: 'account',
    });
    const off = await mira.request('PATCH', '/site-api/account/preferences', {newsletter: false});
    expect((off.json.user as {newsletter: boolean}).newsletter).toBe(false);
    expect(await db.newsletterSubscriber.findUnique({where: {email: 'mira.halvorsen@example.test'}})).toBeNull();
  });

  it('addresses: first is default, one default, the oldest is promoted, other people’s are not found', async () => {
    const base = {name: 'Mira Halvorsen', line1: '112 Studio', city: 'Copenhagen', zip: '2200', country: 'denmark'};
    const a = await mira.post('/site-api/account/addresses', {...base, label: 'Home'});
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({label: 'Home', primary: true, country: 'Denmark'});
    const b = await mira.post('/site-api/account/addresses', {...base, label: 'Studio'});
    expect(b.json.primary).toBe(false);
    const c = await mira.post('/site-api/account/addresses', {...base, label: 'Summer', primary: true});
    expect(c.json.primary).toBe(true);

    let list = (await mira.get('/site-api/account/addresses')).json as unknown as {id: string; label: string; primary: boolean}[];
    expect(list.map(x => [x.label, x.primary])).toEqual([
      ['Summer', true],
      ['Home', false],
      ['Studio', false],
    ]);

    // Un-setting the only default is ignored.
    const keep = await mira.request('PATCH', `/site-api/account/addresses/${c.json.id}`, {primary: false, city: 'Aarhus'});
    expect(keep.json).toMatchObject({primary: true, city: 'Aarhus'});

    // Removing the default promotes the oldest.
    expect((await mira.delete(`/site-api/account/addresses/${c.json.id}`)).status).toBe(204);
    list = (await mira.get('/site-api/account/addresses')).json as unknown as typeof list;
    expect(list.find(x => x.primary)?.label).toBe('Home');

    const stranger = await signedIn(app, 'stranger@example.test', undefined, '203.0.113.33');
    expect((await stranger.request('PATCH', `/site-api/account/addresses/${a.json.id}`, {city: 'X'})).status).toBe(404);
    expect((await stranger.delete(`/site-api/account/addresses/${a.json.id}`)).status).toBe(404);
    expect((await mira.post('/site-api/account/addresses', {...base, country: 'Atlantis'})).status).toBe(422);
  });

  it('refuses a 51st address', async () => {
    await db.address.createMany({
      data: Array.from({length: 50}, (_, i) => ({
        userId: miraId,
        name: 'M',
        line1: `${i} Street`,
        city: 'C',
        zip: '1',
        country: 'Denmark',
        primary: i === 0,
      })),
    });
    const res = await mira.post('/site-api/account/addresses', {name: 'M', line1: 'L', city: 'C', zip: '1', country: 'Denmark'});
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('address_limit');
  });

  it('export is an attachment, never cached', async () => {
    await order({email: 'mira.halvorsen@example.test', userId: miraId});
    const res = await mira.get('/site-api/account/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="varel-data-${miraId}-\\d{4}-\\d{2}-\\d{2}\\.json"$`));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.json.format).toBe('varel-customer-export/1');
  });

  it('delete: refusals pass through, then the account is gone and its orders anonymised', async () => {
    await mira.request('PATCH', '/site-api/account/profile', {firstName: 'Mira', lastName: 'Halvorsen', phone: '+45 1'});
    await mira.post('/site-api/account/addresses', {name: 'M', line1: 'L', city: 'C', zip: '1', country: 'Denmark'});
    await mira.request('PATCH', '/site-api/account/preferences', {newsletter: true});
    const linked = await order({email: 'old.address@example.test', userId: miraId});
    const guest = await order({email: 'mira.halvorsen@example.test'});

    const wrong = await mira.post('/site-api/account/delete', {password: 'not my password', confirm: 'DELETE'});
    expect([401, 422]).toContain(wrong.status);
    expect((wrong.json.fields as Record<string, string>).password).toBeTruthy();
    const noConfirm = await mira.post('/site-api/account/delete', {password: 'a long test passphrase', confirm: 'delete'});
    expect(noConfirm.status).toBe(422);
    expect((noConfirm.json.fields as Record<string, string>).confirm).toBeTruthy();
    expect(await db.user.findUnique({where: {id: miraId}, select: {id: true}})).not.toBeNull();

    const ok = await mira.post('/site-api/account/delete', {password: 'a long test passphrase', confirm: 'DELETE'});
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().some(c => c.startsWith('visitor_id=;'))).toBe(true);
    expect(await db.user.findUnique({where: {id: miraId}, select: {id: true}})).toBeNull();
    expect(await db.customerProfile.findUnique({where: {userId: miraId}})).toBeNull();
    expect(await db.address.count({where: {userId: miraId}})).toBe(0);
    expect(await db.newsletterSubscriber.findUnique({where: {email: 'mira.halvorsen@example.test'}})).toBeNull();
    const rows = await db.shopOrder.findMany({where: {id: {in: [linked.id, guest.id]}}, select: {email: true, phone: true, userId: true}});
    for (const row of rows) {
      expect(row.email).toMatch(/^[mo]\*\*\*@e\*\*\*\.test$/);
      expect(row.phone).toBeNull();
      expect(row.userId).toBeNull();
    }
    expect(sent).toEqual([
      {key: 'account_deleted', to: 'mira.halvorsen@example.test', vars: expect.objectContaining({firstName: 'Mira'})},
    ]);
    expect((await mira.get('/site-api/account/overview')).status).toBe(401);
  });

  it('staff and admins cannot delete themselves here', async () => {
    const owner = await signedIn(app, 'second@example.test', undefined, '203.0.113.34');
    void owner;
    const ownerBrowser = new Browser(app, '203.0.113.30');
    const login = await ownerBrowser.post('/site-api/auth/login', {email: 'owner@example.test', password: 'a long test passphrase'});
    expect(login.status).toBe(200);
    const res = await ownerBrowser.post('/site-api/account/delete', {password: 'a long test passphrase', confirm: 'DELETE'});
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('staff_account');
    expect(sent).toEqual([]);
  });
});
