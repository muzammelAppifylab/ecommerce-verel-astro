import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const sent = vi.hoisted(() => [] as {key: string; to: string; vars: Record<string, unknown>; opts: Record<string, unknown>}[]);
vi.mock('../../src/server/lib/contracts', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/server/lib/contracts')>();
  return {
    ...real,
    sendTemplate: async (_db: unknown, key: string, to: string, vars: Record<string, unknown>, opts: Record<string, unknown> = {}) => {
      sent.push({key, to, vars, opts});
    },
  };
});

import {app} from '../../src/server/app';
import {recovered} from '../../src/server/routes/admin/abandoned-scan';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';
import {bagFixture, catalogFixture, HOUR, orderFixture} from './support/abandoned-fixtures';

/** `/site-api/manage/abandoned` (WP-24) against Postgres. */
describe.skipIf(!DATABASE_URL)('abandoned bags admin (integration)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    sent.length = 0;
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    await catalogFixture();
    await db.setting.update({where: {id: 1}, data: {abandonedCartEnabled: true, abandonedCartHours: 24}});
  }, 120_000);

  /** One bag per status. */
  async function sixBags() {
    const active = await bagFixture({email: 'active@example.com', updatedAgo: 1, lineAgo: [2]});
    const due = await bagFixture({email: 'due@example.com', updatedAgo: 30, lineAgo: [30], qty: 2});
    const reminded = await bagFixture({email: 'reminded@example.com', updatedAgo: 40, lineAgo: [40], reminderAgo: 10});
    const older = await bagFixture({email: 'twice@example.com', updatedAgo: 80, lineAgo: [80]});
    const newer = await bagFixture({email: 'TWICE@example.com', updatedAgo: 3, lineAgo: [3]});
    const dismissed = await bagFixture({email: 'dismissed@example.com', updatedAgo: 50, lineAgo: [50], dismissedAgo: 20});
    const ordered = await bagFixture({email: 'ordered@example.com', updatedAgo: 60, lineAgo: [60]});
    await orderFixture({email: 'ordered@example.com', placedAgo: 5});
    return {active, due, reminded, older, newer, dismissed, ordered};
  }

  it('guards: 401 guest, 403 customer, 200 staff, never public cache', async () => {
    expect((await new Browser(app).get('/site-api/manage/abandoned')).status).toBe(401);
    expect((await customer.get('/site-api/manage/abandoned')).status).toBe(403);
    expect((await customer.request('POST', '/site-api/manage/abandoned/run', {})).status).toBe(403);
    const res = await staff.get('/site-api/manage/abandoned');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control') ?? '').not.toMatch(/public/);
  });

  it('validates the query', async () => {
    const bad = await staff.get('/site-api/manage/abandoned?status=lost');
    expect(bad.status).toBe(422);
    expect(bad.json.fields).toMatchObject({status: 'Use all, active, abandoned, reminded, superseded or dismissed'});
    expect((await staff.get('/site-api/manage/abandoned?sort=name')).json.fields).toMatchObject({sort: 'Sort by lastActivity or value (prefix - for descending)'});
    expect((await staff.get('/site-api/manage/abandoned?pageSize=101')).status).toBe(422);
  });

  it('lists rows, summary and filters', async () => {
    const b = await sixBags();
    const res = await staff.get('/site-api/manage/abandoned');
    expect(res.status).toBe(200);
    const body = res.json as {items: {id: string; status: string; email: string; value: number; itemCount: number}[]; summary: Record<string, {count: number; value: number}>; settings: unknown; nextCursor: string | null};
    expect(body.settings).toEqual({enabled: true, hours: 24});
    const status = Object.fromEntries(body.items.map(r => [r.id, r.status]));
    expect(status).toEqual({[b.active]: 'active', [b.due]: 'abandoned', [b.reminded]: 'reminded', [b.newer]: 'active'});
    for (const s of ['active', 'abandoned', 'reminded', 'superseded', 'dismissed', 'ordered']) expect(body.summary[s]!.count).toBeGreaterThan(0);
    expect(body.summary.active!.count).toBe(2);
    expect(body.summary.abandoned).toEqual({count: 1, value: 50});
    expect(body.items.find(r => r.id === String(b.due))).toMatchObject({itemCount: 2, value: 50, email: 'due@example.com'});

    const only = async (s: string) => ((await staff.get(`/site-api/manage/abandoned?status=${s}`)).json.items as {id: string}[]).map(r => r.id);
    expect(await only('superseded')).toEqual([String(b.older)]);
    expect(await only('dismissed')).toEqual([String(b.dismissed)]);
    expect(await only('ordered')).toEqual([String(b.ordered)]);

    const search = (await staff.get('/site-api/manage/abandoned?q=DUE%40')).json.items as {id: string}[];
    expect(search.map(r => r.id)).toEqual([String(b.due)]);
    expect(((await staff.get('/site-api/manage/abandoned?q=wool+coat')).json.items as unknown[]).length).toBe(4);

    // Keyset paging by value.
    const p1 = (await staff.get('/site-api/manage/abandoned?sort=-value&pageSize=3')).json as {items: {id: string}[]; nextCursor: string};
    expect(p1.items).toHaveLength(3);
    expect(p1.items[0]!.id).toBe(String(b.due));
    const p2 = (await staff.get(`/site-api/manage/abandoned?sort=-value&pageSize=3&cursor=${p1.nextCursor}`)).json as {items: unknown[]; nextCursor: null};
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it('remind: errors, success, dismissed restored, updatedAt kept', async () => {
    expect((await staff.request('POST', '/site-api/manage/abandoned/abc/remind', {})).status).toBe(422);
    const missing = await staff.request('POST', '/site-api/manage/abandoned/999/remind', {});
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({message: 'We cannot find that bag'});

    const noEmail = await bagFixture({email: null, updatedAgo: 30, lineAgo: [30]});
    expect((await staff.request('POST', `/site-api/manage/abandoned/${noEmail}/remind`, {})).json).toMatchObject({error: 'no_email'});

    const ordered = await bagFixture({email: 'ordered@example.com', updatedAgo: 60, lineAgo: [60]});
    await orderFixture({email: 'ordered@example.com', placedAgo: 5});
    const o = await staff.request('POST', `/site-api/manage/abandoned/${ordered}/remind`, {});
    expect(o.status).toBe(409);
    expect(o.json).toMatchObject({error: 'order_placed'});

    const id = await bagFixture({email: 'shopper@example.com', updatedAgo: 50, lineAgo: [50], dismissedAgo: 20, locale: 'da'});
    const before = await db.cart.findUniqueOrThrow({where: {id}, select: {updatedAt: true}});
    const res = await staff.request('POST', `/site-api/manage/abandoned/${id}/remind`, {});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({id: String(id), email: 'shopper@example.com', status: 'reminded', dismissedAt: null});
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({key: 'abandoned_cart', to: 'shopper@example.com', opts: {locale: 'da', related: {type: 'cart', id: String(id)}}});
    expect(String(sent[0]!.vars.cartUrl)).toMatch(/\/site-api\/cart\/recover\//);
    const after = await db.cart.findUniqueOrThrow({where: {id}, select: {updatedAt: true, reminderSentAt: true, dismissedAt: true}});
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.reminderSentAt).not.toBeNull();
    expect(after.dismissedAt).toBeNull();
  });

  it('bulk: validation, dismiss/restore keep updatedAt, remind skips', async () => {
    expect((await staff.request('POST', '/site-api/manage/abandoned/bulk', {ids: [], action: 'dismiss'})).json.fields).toMatchObject({ids: 'Choose at least one bag'});
    const many = Array.from({length: 101}, (_, i) => String(i + 1));
    expect((await staff.request('POST', '/site-api/manage/abandoned/bulk', {ids: many, action: 'dismiss'})).json.fields).toMatchObject({ids: 'Choose at most 100 bags at a time'});
    expect((await staff.request('POST', '/site-api/manage/abandoned/bulk', {ids: ['1'], action: 'nuke'})).json.fields).toMatchObject({action: 'Use remind, dismiss or restore'});

    const b = await sixBags();
    const before = await db.cart.findUniqueOrThrow({where: {id: b.due}, select: {updatedAt: true}});
    const d = await staff.request('POST', '/site-api/manage/abandoned/bulk', {ids: [String(b.due), String(b.due), '9999'], action: 'dismiss'});
    expect(d.json).toEqual({action: 'dismiss', done: 1, skipped: {missing: 1}});
    const mid = await db.cart.findUniqueOrThrow({where: {id: b.due}, select: {updatedAt: true, dismissedAt: true}});
    expect(mid.dismissedAt).not.toBeNull();
    expect(mid.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect((await staff.request('POST', '/site-api/manage/abandoned/bulk', {ids: [String(b.due)], action: 'restore'})).json).toMatchObject({done: 1});
    expect((await db.cart.findUniqueOrThrow({where: {id: b.due}})).dismissedAt).toBeNull();

    const extra = await bagFixture({email: 'due@example.com', updatedAgo: 100, lineAgo: [100]});
    const ids = [b.due, b.older, b.dismissed, b.active, b.newer, extra, 9999].map(String);
    const r = await staff.request('POST', '/site-api/manage/abandoned/bulk', {ids, action: 'remind'});
    expect(r.status).toBe(200);
    // due + active + newer (twice@: the newest bag) are sent; older & extra superseded; dismissed skipped.
    expect(r.json).toEqual({action: 'remind', done: 3, skipped: {superseded: 2, dismissed: 1, missing: 1}});
    expect(sent.map(s => s.to).sort()).toEqual(['TWICE@example.com', 'active@example.com', 'due@example.com']);
  });

  it('recovered: paid orders within 7 days after a reminder email', async () => {
    const now = Date.now();
    const email = async (to: string, agoH: number, status = 'sent') =>
      db.emailMessage.create({data: {template: 'abandoned_cart', to, subject: 's', html: '', text: '', provider: 'outbox', status, createdAt: new Date(now - agoH * HOUR)}});
    await email('a@example.com', 10 * 24);
    await email('b@example.com', 10 * 24);
    await email('c@example.com', 5 * 24, 'failed');
    await email('d@example.com', 5 * 24);
    await email('e@example.com', 5 * 24);
    await orderFixture({email: 'a@example.com', placedAgo: 7 * 24, totalCents: 12345});
    await orderFixture({email: 'b@example.com', placedAgo: 1 * 24});
    await orderFixture({email: 'c@example.com', placedAgo: 4 * 24});
    await orderFixture({email: 'd@example.com', placedAgo: 4 * 24, fulfillment: 'Cancelled'});
    await orderFixture({email: 'e@example.com', placedAgo: 4 * 24, payment: 'Pending'});
    expect(await recovered(db, now)).toEqual({orders: 1, revenue: 123.45});
  });

  it('run: same work as the job', async () => {
    await sixBags();
    const res = await staff.request('POST', '/site-api/manage/abandoned/run', {});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({enabled: true, sent: 1});
    expect(sent.map(s => s.to)).toEqual(['due@example.com']);
    await db.setting.update({where: {id: 1}, data: {abandonedCartEnabled: false}});
    expect((await owner.request('POST', '/site-api/manage/abandoned/run', {})).json).toMatchObject({enabled: false, checked: 0, sent: 0});
  });
});
