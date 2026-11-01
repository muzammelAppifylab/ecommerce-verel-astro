import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

const DAY = 86_400_000;
const todayUtc = () => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};
const at = (daysAgo: number, hour = 12) => new Date(todayUtc() - daysAgo * DAY + hour * 3600_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

let seq = 0;
async function paidOrder(daysAgo: number, totalCents: number, items: {productId: string | null; qty: number; priceCents: number; discountCents?: number; category?: string}[] = [], payment = 'Paid') {
  seq += 1;
  return db.shopOrder.create({
    data: {
      number: `A-${seq}`,
      email: `b${seq}@example.test`,
      method: 'Standard',
      subtotalCents: totalCents,
      totalCents,
      payment,
      placedAt: at(daysAgo),
      items: {
        create: items.map((i, n) => ({
          productId: i.productId,
          name: i.productId ?? 'Deleted',
          category: i.category ?? 'Knitwear',
          sku: `${i.productId ?? 'x'}-${seq}-${n}`,
          qty: i.qty,
          priceCents: i.priceCents,
          discountCents: i.discountCents ?? 0,
          image: {},
        })),
      },
    },
  });
}

const ev = (type: string, sessionId: string, daysAgo: number, extra: {productId?: string; query?: string; results?: number} = {}) => ({
  type,
  sessionId,
  createdAt: at(daysAgo),
  productId: extra.productId ?? null,
  query: extra.query ?? null,
  results: extra.results ?? null,
});

/** GET /site-api/manage/analytics, against Postgres. */
describe.skipIf(!DATABASE_URL)('analytics report (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.32');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);

    const women = await db.department.create({data: {name: 'Women', slug: 'women'}});
    const knit = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: women.id}});
    const base = {brand: 'V', priceCents: 1000, short: 's', description: 'd', material: 'm', departmentId: women.id, categoryId: knit.id};
    await db.product.create({data: {id: 'p1', name: 'Wool jumper', sku: 'S1', ...base}});
    await db.product.create({data: {id: 'p2', name: 'Linen shirt', sku: 'S2', ...base}});
  });

  it('a role without analytics is refused', async () => {
    expect((await owner.post('/site-api/admin/roles', {slug: 'writer', name: 'Writer', permissions: ['site:content:manage']})).status).toBeLessThan(300);
    const writer = await signedIn(app, 'writer@example.test', undefined, '203.0.113.33');
    const wid = await userId('writer@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${wid}/roles`, {roles: ['member', 'writer']})).status).toBe(200);
    expect((await writer.get('/site-api/manage/analytics')).status).toBe(403);
    expect((await staff.get('/site-api/manage/analytics')).status).toBe(200);
  });

  it('totals, funnel, departments, products and searches', async () => {
    await db.analyticsEvent.createMany({
      data: [
        ev('page_view', 's1', 1),
        ev('page_view', 's1', 1),
        ev('page_view', 's2', 2),
        ev('page_view', 's3', 3),
        ev('page_view', 's4', 4),
        ev('product_view', 's1', 1, {productId: 'p1'}),
        ev('product_view', 's2', 2, {productId: 'p1'}),
        ev('product_view', 's2', 2, {productId: 'p2'}),
        ev('add_to_cart', 's1', 1, {productId: 'p1'}),
        ev('checkout_start', 's1', 1),
        ev('search', 's3', 3, {query: 'wool', results: 4}),
        ev('search', 's4', 4, {query: 'wool', results: 1}),
        ev('search', 's4', 4, {query: 'silk', results: 0}),
        ev('search', 's3', 2, {query: 'silk', results: 0}),
        ev('search', 's3', 5, {query: 'cashmere', results: 0}),
        ev('page_view', 'old', 60),
      ],
    });
    await paidOrder(1, 12_000, [
      {productId: 'p1', qty: 2, priceCents: 5000, discountCents: 1000},
      {productId: null, qty: 1, priceCents: 2000, category: 'Archive'},
    ]);
    await paidOrder(2, 3_000, [], 'Pending');

    const res = await staff.get('/site-api/manage/analytics');
    expect(res.status).toBe(200);
    const a = res.json as Record<string, any>;
    expect(a.days).toBe(30);
    expect(a.to).toBe(iso(new Date(todayUtc())));
    expect(a.totals).toMatchObject({sessions: 4, pageViews: 5, productViews: 3, orders: 1, revenue: 120, averageOrder: 120, conversionRate: 0.25});
    expect(a.funnel.map((s: {count: number}) => s.count)).toEqual([4, 2, 1, 1, 1]);
    expect(a.revenueByDay).toHaveLength(30);
    expect(a.revenueByDepartment).toEqual([
      {name: 'Women', revenue: 90, units: 2},
      {name: 'Unlisted', revenue: 20, units: 1},
    ]);
    expect(a.revenueByCategory.map((c: {name: string}) => c.name)).toEqual(['Knitwear', 'Archive']);
    expect(a.topProducts[0]).toEqual({productId: 'p1', name: 'Wool jumper', views: 2, addToBag: 1});
    expect(a.topProducts[1]).toMatchObject({productId: 'p2', addToBag: 0});
    expect(a.topSearches[0]).toEqual({query: 'silk', count: 2, avgResults: 0});
    expect(a.topSearches[1]).toEqual({query: 'wool', count: 2, avgResults: 2.5});
    expect(a.noResultSearches[0]).toMatchObject({query: 'silk', count: 2});
    expect(a.noResultSearches[0].lastSearched).toBe(at(2).toISOString());
  });

  it('custom ranges are inclusive; the lifetime extends; month buckets', async () => {
    await db.analyticsEvent.createMany({data: [ev('page_view', 'x', 10), ev('page_view', 'y', 200)]});
    const day = iso(at(10));
    const one = (await staff.get(`/site-api/manage/analytics?from=${day}&to=${day}`)).json as Record<string, any>;
    expect(one.days).toBe(1);
    expect(one.totals.sessions).toBe(1);

    const all = (await staff.get('/site-api/manage/analytics?days=all')).json as Record<string, any>;
    expect(all.lifetime).toBe(true);
    expect(all.from).toBe(iso(at(200)));
    expect(all.bucket).toBe('month');
    expect(all.totals.sessions).toBe(2);
  });

  it('refuses bad ranges', async () => {
    const cases: [string, string][] = [
      ['?from=2026/01/01', 'from'],
      ['?to=2026-02-31', 'to'],
      ['?from=2026-03-10&to=2026-03-01', 'from'],
      ['?from=2025-01-01&to=2026-01-02', 'from'],
      ['?days=5', 'days'],
    ];
    for (const [q, field] of cases) {
      const res = await staff.get(`/site-api/manage/analytics${q}`);
      expect(res.status, q).toBe(422);
      expect((res.json as {fields: Record<string, string>}).fields[field], q).toBeTruthy();
    }
  });
});
