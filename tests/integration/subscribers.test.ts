import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** WP-20 newsletter sign-up and admin Subscribers against Postgres. */
describe.skipIf(!DATABASE_URL)('newsletter + manage/subscribers (integration)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.32');
    customer = await signedIn(app, 'ann@example.test', undefined, '203.0.113.33');
    const made = await owner.request('PUT', `/site-api/admin/users/${await userId('staff@example.test')}/roles`, {roles: ['member', 'staff']});
    expect(made.status).toBe(200);
  });

  it('POST /newsletter subscribes idempotently and sets the opt-in', async () => {
    await db.customerProfile.create({data: {userId: await userId('ann@example.test')}});
    const guest = new Browser(app, '203.0.113.34');
    expect((await guest.post('/site-api/newsletter', {email: ' Ann@Example.test ', source: 'footer'})).status).toBe(204);
    expect((await guest.post('/site-api/newsletter', {email: 'ann@example.test', source: 'journal'})).status).toBe(204);
    const rows = await db.newsletterSubscriber.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({email: 'ann@example.test', source: 'footer'});
    expect((await db.customerProfile.findFirstOrThrow()).marketingOptIn).toBe(true);
    const bad = await guest.post('/site-api/newsletter', {email: 'nope'});
    expect(bad.status).toBe(422);
    expect(bad.json.fields).toHaveProperty('email');
  });

  it('POST /newsletter refuses a flood', async () => {
    await db.newsletterSubscriber.createMany({data: Array.from({length: 31}, (_, i) => ({email: `f${i}@x.test`}))});
    const res = await new Browser(app, '203.0.113.35').post('/site-api/newsletter', {email: 'late@x.test'});
    expect(res.status).toBe(429);
    expect(res.json.error).toBe('rate_limited');
  });

  it('lists with guards, keyset pages, search and sort', async () => {
    await db.newsletterSubscriber.createMany({
      data: [
        {email: 'a@x.test', source: 'footer', createdAt: new Date('2026-01-01')},
        {email: 'b@x.test', source: 'journal', createdAt: new Date('2026-01-02')},
        {email: 'c@y.test', source: 'footer', createdAt: new Date('2026-01-03')},
      ],
    });
    expect((await new Browser(app).get('/site-api/manage/subscribers')).status).toBe(401);
    expect((await customer.get('/site-api/manage/subscribers')).status).toBe(403);
    const first = await staff.get('/site-api/manage/subscribers?pageSize=2');
    expect(first.status).toBe(200);
    expect((first.json.items as {email: string}[]).map(r => r.email)).toEqual(['c@y.test', 'b@x.test']);
    const second = await staff.get(`/site-api/manage/subscribers?pageSize=2&cursor=${encodeURIComponent(first.json.nextCursor as string)}`);
    expect((second.json.items as {email: string}[]).map(r => r.email)).toEqual(['a@x.test']);
    expect(second.json.nextCursor ?? null).toBeNull();
    expect((await staff.get('/site-api/manage/subscribers?q=x.test%20footer')).json.items).toHaveLength(1);
    expect(((await staff.get('/site-api/manage/subscribers?sort=email')).json.items as {email: string}[])[0]!.email).toBe('a@x.test');
    expect((await staff.get('/site-api/manage/subscribers?sort=source')).status).toBe(422);
  });

  it('exports CSV with escaping, filter and audit', async () => {
    await db.newsletterSubscriber.createMany({data: [{email: '=cmd@x.test', source: 'footer'}, {email: 'b@y.test'}]});
    const res = await staff.get('/site-api/manage/subscribers/export.csv?q=x.test');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="varel-subscribers-/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const lines = String(res.json.text).trim().split('\r\n');
    expect(lines[0]).toBe('Email,Source,Subscribed');
    expect(lines).toHaveLength(2);
    expect(lines[1]!.startsWith("'=cmd@x.test,footer,")).toBe(true);
    expect(await db.auditEvent.count({where: {action: 'subscribers_exported'}})).toBe(1);
  });

  it('removes a subscriber and clears the opt-in', async () => {
    await db.customerProfile.create({data: {userId: await userId('ann@example.test'), marketingOptIn: true}});
    await db.newsletterSubscriber.create({data: {email: 'ann@example.test'}});
    expect((await customer.delete('/site-api/manage/subscribers/ann%40example.test')).status).toBe(403);
    expect((await staff.delete('/site-api/manage/subscribers/ann%40example.test')).status).toBe(204);
    expect(await db.newsletterSubscriber.count()).toBe(0);
    expect((await db.customerProfile.findFirstOrThrow()).marketingOptIn).toBe(false);
    const again = await staff.delete('/site-api/manage/subscribers/ann%40example.test');
    expect(again.status).toBe(404);
    expect(again.json.error).toBe('not_subscribed');
  });
});
