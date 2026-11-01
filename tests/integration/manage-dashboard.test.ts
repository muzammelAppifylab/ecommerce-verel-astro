import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

const DAY = 86_400_000;
const todayUtc = () => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};
/** Noon UTC, `daysAgo` days before today. */
const at = (daysAgo: number) => new Date(todayUtc() - daysAgo * DAY + 12 * 3600_000);

let seq = 0;
async function order(o: {daysAgo: number; totalCents: number; payment?: string; fulfillment?: string; email?: string; userId?: number; address?: object; items?: {productId: string; qty: number; priceCents: number; name?: string}[]}) {
  seq += 1;
  return db.shopOrder.create({
    data: {
      number: `T-${seq}`,
      email: o.email ?? `buyer${seq}@example.test`,
      method: 'Standard',
      subtotalCents: o.totalCents,
      totalCents: o.totalCents,
      payment: o.payment ?? 'Paid',
      fulfillment: o.fulfillment ?? 'Delivered',
      placedAt: at(o.daysAgo),
      userId: o.userId,
      address: o.address,
      items: {
        create: (o.items ?? []).map((i, n) => ({
          productId: i.productId,
          name: i.name ?? i.productId,
          category: 'Knitwear',
          sku: `${i.productId}-${seq}-${n}`,
          qty: i.qty,
          priceCents: i.priceCents,
          image: {},
        })),
      },
    },
  });
}

async function catalogue() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}});
  const cat = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: dept.id}});
  const base = {brand: 'V', priceCents: 1000, short: 's', description: 'd', material: 'm', departmentId: dept.id, categoryId: cat.id};
  for (const [id, extra] of [
    ['a', {}],
    ['b', {}],
    ['c', {}],
    ['old', {status: 'archived'}],
    ['dl', {type: 'digital'}],
  ] as const) {
    await db.product.create({data: {id, name: `Product ${id}`, sku: `SKU-${id}`, ...base, ...extra}});
  }
  await db.variant.createMany({
    data: [
      {id: 'a-1', productId: 'a', priceCents: 1000, inventory: 0, size: 'S'},
      {id: 'a-2', productId: 'a', priceCents: 1000, inventory: 3, size: 'M'},
      {id: 'b-1', productId: 'b', priceCents: 1000, inventory: 50},
      {id: 'c-1', productId: 'c', priceCents: 1000, inventory: null},
      {id: 'old-1', productId: 'old', priceCents: 1000, inventory: 0},
      {id: 'dl-1', productId: 'dl', priceCents: 1000, inventory: 0},
    ],
  });
}

/** GET /site-api/manage/dashboard (+ /counts), against Postgres. */
describe.skipIf(!DATABASE_URL)('dashboard (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let member: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    member = await signedIn(app, 'member@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    await catalogue();
  });

  it('guards: guests 401, customers 403, a content-only role 200', async () => {
    expect((await new Browser(app).get('/site-api/manage/dashboard')).status).toBe(401);
    expect((await member.get('/site-api/manage/dashboard')).status).toBe(403);
    expect((await member.get('/site-api/manage/dashboard/counts')).status).toBe(403);
    const role = await owner.post('/site-api/admin/roles', {slug: 'writer', name: 'Writer', permissions: ['site:content:manage']});
    expect(role.status).toBeLessThan(300);
    const writer = await signedIn(app, 'writer@example.test', undefined, '203.0.113.24');
    const wid = await userId('writer@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${wid}/roles`, {roles: ['member', 'writer']})).status).toBe(200);
    expect((await writer.get('/site-api/manage/dashboard')).status).toBe(200);
  });

  it('totals, comparison, top products, low stock and recent orders', async () => {
    const memberId = await userId('member@example.test');
    await db.customerProfile.upsert({
      where: {userId: memberId},
      create: {userId: memberId, firstName: 'Ada', lastName: 'Lovelace'},
      update: {firstName: 'Ada', lastName: 'Lovelace'},
    });
    // Current 30 days.
    await order({daysAgo: 0, totalCents: 10_000, items: [{productId: 'a', qty: 2, priceCents: 5000}], userId: memberId});
    await order({daysAgo: 5, totalCents: 5_000, items: [{productId: 'b', qty: 1, priceCents: 5000}], address: {name: 'Shipping Name'}});
    await order({daysAgo: 6, totalCents: 3_000, payment: 'Pending', fulfillment: 'Unfulfilled', items: [{productId: 'b', qty: 3, priceCents: 1000}]});
    await order({daysAgo: 7, totalCents: 9_999, payment: 'Failed', fulfillment: 'Unfulfilled'});
    await order({daysAgo: 8, totalCents: 8_888, fulfillment: 'Cancelled', items: [{productId: 'c', qty: 9, priceCents: 1000}]});
    await order({daysAgo: 9, totalCents: 2_000, fulfillment: 'Processing', items: [{productId: 'c', qty: 1, priceCents: 2000}]});
    // Previous 30 days.
    await order({daysAgo: 40, totalCents: 4_000});

    const res = await staff.get('/site-api/manage/dashboard');
    expect(res.status).toBe(200);
    const d = res.json as Record<string, any>;
    expect(d.periodDays).toBe(30);
    expect(d.lifetime).toBe(false);
    expect(d.salesBucket).toBe('day');
    expect(d.salesByDay).toHaveLength(30);
    expect(d.revenue30d).toBe(170);
    expect(d.orders30d).toBe(4);
    expect(d.averageOrder30d).toBe(56.67);
    expect(d.revenuePrev30d).toBe(40);
    expect(d.ordersPrev30d).toBe(1);
    expect(d.openOrders).toBe(2);
    expect(d.salesByDay.reduce((s: number, x: {total: number}) => s + x.total, 0)).toBe(170);
    expect(d.topProducts.map((p: {productId: string}) => p.productId)).toEqual(['a', 'b', 'c']);
    expect(d.topProducts[0]).toMatchObject({units: 2, revenue: 100});
    expect(d.lowStock.map((v: {variantId: string}) => v.variantId)).toEqual(['a-1', 'a-2']);
    expect(d.lowStock[0].state).toBe('out');
    expect(d.lowStock[1].state).toBe('low');
    expect(d.recentOrders).toHaveLength(7);
    expect(d.recentOrders[0].customerName).toBe('Ada Lovelace');
    expect(d.recentOrders[0].count).toBe(2);
    expect(d.recentOrders[1].customerName).toBe('Shipping Name');
    expect(d.recentOrders[2].customerName).toMatch(/@example\.test$/);
    // Only the member is a customer (owner and staff are team).
    expect(d.customers).toBe(1);

    const counts = await staff.get('/site-api/manage/dashboard/counts');
    expect(counts.json).toEqual({openOrders: d.openOrders, pendingReturns: d.pendingReturns});
  });

  it('threshold from the settings, 7 / 90 / lifetime windows, lenient days', async () => {
    await db.setting.update({where: {id: 1}, data: {lowStockThreshold: 0}});
    await order({daysAgo: 2, totalCents: 1_000});
    await order({daysAgo: 200, totalCents: 2_000});

    const seven = (await staff.get('/site-api/manage/dashboard?days=7')).json as Record<string, any>;
    expect(seven.periodDays).toBe(7);
    expect(seven.salesByDay).toHaveLength(7);
    expect(seven.lowStock.map((v: {variantId: string}) => v.variantId)).toEqual(['a-1']);
    expect(((await staff.get('/site-api/manage/dashboard?days=90')).json as {periodDays: number}).periodDays).toBe(90);
    expect(((await staff.get('/site-api/manage/dashboard?days=abc')).json as {periodDays: number}).periodDays).toBe(30);

    const all = (await staff.get('/site-api/manage/dashboard?days=all')).json as Record<string, any>;
    expect(all.lifetime).toBe(true);
    expect(all.periodDays).toBe(201);
    expect(all.since).toBe(at(200).toISOString().slice(0, 10));
    expect(all.salesBucket).toBe('month');
    expect(all.revenue30d).toBe(30);
    expect(all.revenuePrev30d).toBe(0);
    expect(all.ordersPrev30d).toBe(0);
  });

  it('pending returns are counted', async () => {
    const o = await order({daysAgo: 1, totalCents: 1_000});
    await db.returnRequest.createMany({
      data: ['Requested', 'Approved', 'Received', 'Refunded'].map(status => ({orderId: o.id, email: o.email, items: [], status})),
    });
    expect((await staff.get('/site-api/manage/dashboard/counts')).json).toEqual({openOrders: 0, pendingReturns: 3});
  });
});
