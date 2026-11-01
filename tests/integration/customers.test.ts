import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

let n = 0;
const order = (data: {email: string; userId?: number | null; totalCents: number; payment?: string; placedAt?: Date}) =>
  db.shopOrder.create({
    data: {number: `VR-${++n}`, method: 'Standard', subtotalCents: data.totalCents, ...data},
    select: {id: true},
  });

/** WP-20 admin Customers against Postgres. */
describe.skipIf(!DATABASE_URL)('manage/customers (integration)', () => {
  let owner: Browser;
  let admin: Browser;
  let staff: Browser;
  let customer: Browser;
  let customerId: number;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    n = 0;
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    admin = await signedIn(app, 'admin@example.test', undefined, '203.0.113.22');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.23');
    customer = await signedIn(app, 'ann@example.test', undefined, '203.0.113.24');
    expect((await owner.request('PUT', `/site-api/admin/users/${await userId('staff@example.test')}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    expect((await owner.request('PUT', `/site-api/admin/users/${await userId('admin@example.test')}/roles`, {roles: ['member', 'admin']})).status).toBe(200);
    customerId = await userId('ann@example.test');
  });

  it('guards: guests 401, customers 403, staff in', async () => {
    expect((await new Browser(app).get('/site-api/manage/customers')).status).toBe(401);
    expect((await customer.get('/site-api/manage/customers')).status).toBe(403);
    expect((await staff.get('/site-api/manage/customers')).status).toBe(200);
  });

  it('lists accounts with stats, newsletter and role filter', async () => {
    await db.customerProfile.create({data: {userId: customerId, firstName: 'Ann', lastName: 'Berg', phone: '+45 1234'}});
    await order({email: 'ann@example.test', userId: customerId, totalCents: 10000, placedAt: new Date('2026-01-01')});
    await order({email: 'ann@example.test', userId: null, totalCents: 5050, placedAt: new Date('2026-02-01')});
    await order({email: 'ann@example.test', userId: customerId, totalCents: 999, payment: 'Refunded', placedAt: new Date('2026-03-01')});
    await db.newsletterSubscriber.create({data: {email: 'ann@example.test', source: 'footer'}});

    const res = await staff.get('/site-api/manage/customers?role=customer');
    expect(res.status).toBe(200);
    const items = res.json.items as Record<string, unknown>[];
    expect(items.map(i => i.email)).toEqual(['ann@example.test']);
    expect(items[0]).toMatchObject({name: 'Ann Berg', role: 'customer', orders: 3, spent: 150.5, newsletter: true});
    expect(String(items[0]!.lastOrderAt)).toContain('2026-03-01');

    const roles = (await staff.get('/site-api/manage/customers?role=staff&role=admin')).json.items as {email: string; role: string}[];
    expect(roles.map(r => [r.email, r.role]).sort()).toEqual([
      ['admin@example.test', 'admin'],
      ['owner@example.test', 'admin'],
      ['staff@example.test', 'staff'],
    ]);
    expect((await staff.get('/site-api/manage/customers?q=berg%201234')).json.items).toHaveLength(1);
    expect((await staff.get('/site-api/manage/customers?role=boss')).status).toBe(422);
    expect((await staff.get('/site-api/manage/customers?sort=spent')).status).toBe(422);
  });

  it('pages by keyset without duplicates', async () => {
    for (const sort of ['-createdAt', 'email', 'name']) {
      const seen: string[] = [];
      let cursor = '';
      for (let i = 0; i < 5; i++) {
        const res = await staff.get(`/site-api/manage/customers?sort=${sort}&pageSize=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.status).toBe(200);
        seen.push(...(res.json.items as {email: string}[]).map(r => r.email));
        if (!res.json.nextCursor) break;
        cursor = res.json.nextCursor as string;
      }
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
    }
  });

  it('detail, 404 and 422', async () => {
    await db.address.createMany({
      data: [
        {userId: customerId, name: 'Ann', line1: 'A 1', city: 'Aarhus', zip: '8000', country: 'DK'},
        {userId: customerId, name: 'Ann', line1: 'B 2', city: 'Aarhus', zip: '8000', country: 'DK', primary: true},
      ],
    });
    for (let i = 0; i < 12; i++) await order({email: 'ann@example.test', userId: customerId, totalCents: 100, placedAt: new Date(2026, 0, i + 1)});
    const res = await staff.get(`/site-api/manage/customers/${customerId}`);
    expect(res.status).toBe(200);
    expect(res.json.orders).toBe(12);
    const recent = res.json.recentOrders as {placedAt: string}[];
    expect(recent).toHaveLength(10);
    expect(recent[0]!.placedAt > recent[1]!.placedAt).toBe(true);
    expect((res.json.addresses as {line1: string}[]).map(a => a.line1)).toEqual(['B 2', 'A 1']);
    expect(res.json.wishlistCount).toBe(0);
    expect((await staff.get('/site-api/manage/customers/99999')).status).toBe(404);
    expect((await staff.get('/site-api/manage/customers/abc')).status).toBe(422);
  });

  it('PATCH edits the profile, creating it when missing, never users', async () => {
    const bad = await staff.request('PATCH', `/site-api/manage/customers/${customerId}`, {});
    expect(bad.status).toBe(422);
    expect((await staff.request('PATCH', `/site-api/manage/customers/${customerId}`, {firstName: 'x'.repeat(81)})).status).toBe(422);
    const ok = await staff.request('PATCH', `/site-api/manage/customers/${customerId}`, {firstName: 'Anna', phone: '555'});
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({name: expect.stringContaining('Anna'), phone: '555'});
    const user = await db.user.findUniqueOrThrow({where: {id: customerId}, select: {name: true}});
    expect(user.name).toBe('ann');
  });

  it('export: admins only, attachment, audited', async () => {
    expect((await staff.get(`/site-api/manage/customers/${customerId}/export`)).status).toBe(403);
    const res = await admin.get(`/site-api/manage/customers/${customerId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="varel-data-/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.json.format).toBe('varel-customer-export/1');
    expect(await db.auditEvent.count({where: {action: 'customer_data_exported'}})).toBe(1);
  });

  it('delete: admins only, typed email, customers only; erases the account', async () => {
    await db.customerProfile.create({data: {userId: customerId, firstName: 'Ann'}});
    await db.address.create({data: {userId: customerId, name: 'Ann', line1: 'A 1', city: 'Aarhus', zip: '8000', country: 'DK'}});
    await db.newsletterSubscriber.create({data: {email: 'ann@example.test'}});
    const {id: orderId} = await order({email: 'ann@example.test', userId: customerId, totalCents: 100});
    const path = `/site-api/manage/customers/${customerId}`;

    expect((await staff.request('DELETE', path, {confirmEmail: 'ann@example.test'})).status).toBe(403);
    const wrong = await admin.request('DELETE', path, {confirmEmail: 'nope@example.test'});
    expect(wrong.status).toBe(422);
    expect(wrong.json.fields).toMatchObject({confirmEmail: 'The email does not match'});
    const staffId = await userId('staff@example.test');
    expect((await admin.request('DELETE', `/site-api/manage/customers/${staffId}`, {confirmEmail: 'staff@example.test'})).status).toBe(409);

    const ok = await admin.request('DELETE', path, {confirmEmail: ' ANN@example.test '});
    expect(ok.status).toBe(204);
    expect(await db.user.findUnique({where: {id: customerId}})).toBeNull();
    expect(await db.customerProfile.count({where: {userId: customerId}})).toBe(0);
    expect(await db.address.count({where: {userId: customerId}})).toBe(0);
    expect(await db.newsletterSubscriber.count({where: {email: 'ann@example.test'}})).toBe(0);
    const kept = await db.shopOrder.findUniqueOrThrow({where: {id: orderId}, select: {email: true, userId: true}});
    expect(kept.userId).toBeNull();
    expect(kept.email).not.toBe('ann@example.test');
    expect(await db.auditEvent.count({where: {action: 'customer_deleted'}})).toBe(1);
    expect((await admin.get(path)).status).toBe(404);
  });
});
