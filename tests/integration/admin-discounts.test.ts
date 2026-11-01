import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

const BASE = '/site-api/manage/discounts';

type Row = Record<string, unknown> & {id: string; name: string; code: string | null};

/** WP-21 · Discounts admin (`/site-api/manage/discounts`) against Postgres. */
describe.skipIf(!DATABASE_URL)('discounts admin (integration, real Postgres)', () => {
  let staff: Browser;
  let customer: Browser;
  let customerId: number;
  let ids: {studio: number; welcome: number; auto: number; unused: number};

  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    const owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.32');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.33');
    customerId = await userId('customer@example.test');
    const sid = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${sid}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    await db.customerProfile.create({data: {userId: customerId, firstName: 'Cara', lastName: 'Lane'}});
  }, 120_000);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "departments", "categories", "products", "discounts", "discount_codes", "discount_redemptions", "shop_orders", "audit_events", "activity_logs" RESTART IDENTITY CASCADE'
    );

    const dept = await db.department.create({data: {name: 'Women', slug: 'women'}});
    const cat = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: dept.id}});
    await db.product.create({
      data: {
        id: 'wool-jumper',
        name: 'Wool jumper',
        brand: 'VAREL',
        priceCents: 12000,
        sku: 'WJ-1',
        short: 'Warm',
        description: 'Warm',
        material: 'Wool',
        departmentId: dept.id,
        categoryId: cat.id,
      },
    });
    const studio = await db.discount.create({
      data: {method: 'code', name: 'STUDIO10', code: 'STUDIO10', codeType: 'shared', kind: 'percent', percentOff: 10, scope: 'order', label: '10% off', note: 'Any order'},
    });
    const welcome = await db.discount.create({
      data: {method: 'code', name: 'Welcome', codeType: 'unique', kind: 'percent', percentOff: 15, maxAmountCents: 4000, scope: 'order', label: '15% off', note: 'Any order'},
    });
    const auto = await db.discount.create({
      data: {method: 'automatic', name: 'Autumn knitwear', codeType: 'shared', kind: 'percent', percentOff: 20, scope: 'categories', categoryIds: [cat.id], label: '20% off Knitwear', note: 'Applied automatically'},
    });
    const unused = await db.discount.create({
      data: {method: 'code', name: 'FREESHIP', code: 'FREESHIP', codeType: 'shared', kind: 'shipping', scope: 'order', label: 'Free shipping', note: 'Any order'},
    });
    ids = {studio: studio.id, welcome: welcome.id, auto: auto.id, unused: unused.id};

    const order = (n: number, payment: string, total: number) =>
      db.shopOrder.create({data: {number: `VR-${1000 + n}`, email: n === 3 ? 'other@example.test' : 'customer@example.test', userId: n === 3 ? null : customerId, payment, method: 'Standard', subtotalCents: total, totalCents: total}});
    const o1 = await order(1, 'Paid', 10000);
    const o2 = await order(2, 'Paid', 20000);
    const o3 = await order(3, 'Pending', 5000);
    for (const [o, amount] of [
      [o1, 1000],
      [o2, 2000],
      [o3, 500],
    ] as const)
      await db.discountRedemption.create({data: {discountId: studio.id, orderId: o.id, email: o.email, code: 'STUDIO10', amountCents: amount}});
    await db.discountCode.createMany({
      data: Array.from({length: 20}, (_, i) => ({discountId: welcome.id, code: `WELCOME-${String(i).padStart(3, '0')}AB`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, i))})),
    });
    await db.discountCode.update({where: {code: 'WELCOME-003AB'}, data: {usedAt: new Date(), orderId: o1.id}});
  });

  it('guards: 401 signed out, 403 for a customer, 200 for staff', async () => {
    expect((await new Browser(app).get(BASE)).status).toBe(401);
    expect((await customer.get(BASE)).status).toBe(403);
    const res = await staff.get(BASE);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('lists with stats, filters by method/status and finds unique codes', async () => {
    const all = (await staff.get(BASE)).json as unknown as Row[];
    expect(all).toHaveLength(4);
    const studio = all.find(d => d.code === 'STUDIO10')!;
    expect(studio).toMatchObject({used: 3, totalDiscounted: 30, revenue: 300, status: 'active', value: 10});
    const welcome = all.find(d => d.name === 'Welcome')!;
    expect(welcome).toMatchObject({codesTotal: 20, codesUsed: 1, maxAmount: 40});
    expect(welcome.summary).toBe('15% off up to $40 · 20 unique codes');
    expect(((await staff.get(`${BASE}?method=automatic`)).json as unknown as Row[]).map(d => d.name)).toEqual(['Autumn knitwear']);
    expect(((await staff.get(`${BASE}?status=inactive`)).json as unknown as Row[])).toHaveLength(0);
    expect(((await staff.get(`${BASE}?q=welcome-003`)).json as unknown as Row[]).map(d => d.name)).toEqual(['Welcome']);
    expect((await staff.get(`${BASE}?method=nope`)).status).toBe(422);
  });

  it('creates with defaults and refuses taken codes', async () => {
    const res = await staff.post(BASE, {code: 'summer15', kind: 'percent', value: 15, minimum: 100});
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({code: 'SUMMER15', name: 'SUMMER15', label: '15% off', note: 'Minimum spend $100', value: 15, minimum: 100});
    const taken = await staff.post(BASE, {code: 'studio10', kind: 'shipping'});
    expect(taken.status).toBe(409);
    expect((taken.json.fields as Record<string, string>).code).toBeDefined();
    const vsUnique = await staff.post(BASE, {code: 'WELCOME-001AB', kind: 'shipping'});
    expect(vsUnique.status).toBe(409);
    const noKind = await staff.post(BASE, {code: 'NOKIND'});
    expect(noKind.status).toBe(422);
    expect((noKind.json.fields as Record<string, string>).kind).toBeDefined();
    const badTarget = await staff.post(BASE, {code: 'TARGET1', kind: 'shipping', scope: 'products', productIds: ['nope']});
    expect(badTarget.status).toBe(422);
    expect((badTarget.json.fields as Record<string, string>)['productIds.0']).toBe('We cannot find that product');
    const autoUnique = await staff.post(BASE, {method: 'automatic', name: 'X', kind: 'shipping', codeType: 'unique'});
    expect(autoUnique.status).toBe(422);
    expect((autoUnique.json.fields as Record<string, string>).codeType).toBeDefined();
  });

  it('patches: overlay, label regeneration, unique guard, 404s', async () => {
    const res = await staff.request('PATCH', `${BASE}/${ids.studio}`, {value: 12});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({value: 12, label: '12% off', code: 'STUDIO10'});
    await staff.request('PATCH', `${BASE}/${ids.studio}`, {label: 'Studio friends'});
    expect((await staff.request('PATCH', `${BASE}/${ids.studio}`, {value: 14})).json).toMatchObject({label: 'Studio friends'});
    const toShared = await staff.request('PATCH', `${BASE}/${ids.welcome}`, {codeType: 'shared', code: 'WELCOMEALL'});
    expect(toShared.status).toBe(422);
    expect((toShared.json.fields as Record<string, string>).codeType).toMatch(/Delete the unique codes first/);
    // A deleted target does not block an unrelated edit.
    await db.discount.update({where: {id: ids.auto}, data: {categoryIds: [999]}});
    expect((await staff.request('PATCH', `${BASE}/${ids.auto}`, {priority: 5})).status).toBe(200);
    expect((await staff.request('PATCH', `${BASE}/99999`, {priority: 1})).status).toBe(404);
    expect((await staff.get(`${BASE}/abc`)).status).toBe(404);
  });

  it('deletes unused, deactivates used', async () => {
    expect((await staff.delete(`${BASE}/${ids.unused}`)).status).toBe(204);
    const used = await staff.delete(`${BASE}/${ids.studio}`);
    expect(used.status).toBe(200);
    expect(used.json).toMatchObject({deactivated: true, discount: {active: false}});
  });

  it('generates, lists (keyset), exports and deletes unused codes', async () => {
    const gen = await staff.post(`${BASE}/${ids.welcome}/codes`, {count: 50, prefix: 'vip-', length: 8});
    expect(gen.status).toBe(201);
    expect(gen.json).toEqual({created: 50});
    expect((await staff.post(`${BASE}/${ids.studio}/codes`, {count: 5})).status).toBe(422);

    const first = await staff.get(`${BASE}/${ids.welcome}/codes?pageSize=40`);
    const page1 = first.json.items as {code: string}[];
    expect(page1).toHaveLength(40);
    const second = await staff.get(`${BASE}/${ids.welcome}/codes?pageSize=40&cursor=${encodeURIComponent(String(first.json.nextCursor))}`);
    const page2 = second.json.items as {code: string}[];
    expect(page2).toHaveLength(30);
    expect(new Set([...page1, ...page2].map(c => c.code)).size).toBe(70);

    const used = (await staff.get(`${BASE}/${ids.welcome}/codes?used=true`)).json.items as {code: string; orderNumber: string}[];
    expect(used).toEqual([expect.objectContaining({code: 'WELCOME-003AB', orderNumber: 'VR-1001'})]);
    expect(((await staff.get(`${BASE}/${ids.welcome}/codes?q=vr-1001`)).json.items as unknown[]).length).toBe(1);

    const csv = await staff.get(`${BASE}/${ids.welcome}/codes.csv?used=true`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-disposition')).toMatch(/varel-welcome-codes-\d{4}-\d{2}-\d{2}\.csv/);
    expect(String(csv.json.text).split(/\r?\n/)[0]).toBe('Code,Used,Used at,Order');

    const del = await staff.delete(`${BASE}/${ids.welcome}/codes`);
    expect(del.json).toEqual({deleted: 69});
    expect(await db.discountCode.count({where: {discountId: ids.welcome}})).toBe(1);
  });

  it('reports totals from paid orders, 30 days and recent redemptions', async () => {
    const r = (await staff.get(`${BASE}/${ids.studio}/report`)).json as Record<string, unknown>;
    expect(r).toMatchObject({uses: 3, customers: 2, discountGiven: 30, revenue: 300, averageOrder: 150});
    expect(r.byDay as unknown[]).toHaveLength(30);
    const recent = r.recent as {orderNumber: string; customer: string}[];
    expect(recent).toHaveLength(3);
    expect(recent.find(x => x.orderNumber === 'VR-1001')?.customer).toBe('Cara Lane');
  });

  it('preview and names never offer staff', async () => {
    const empty = (await staff.get(`${BASE}/preview`)).json as {products: unknown[]; customers: unknown[]};
    expect(empty.products).toHaveLength(1);
    expect(empty.customers).toEqual([]);
    const hits = (await staff.get(`${BASE}/preview?q=example`)).json as {customers: {email: string}[]};
    expect(hits.customers.map(c => c.email)).toEqual(['customer@example.test']);
    const sid = await userId('staff@example.test');
    const names = (await staff.get(`${BASE}/names?kind=customer&ids=${customerId},${sid}`)).json as unknown as {id: string; name: string}[];
    expect(names).toEqual([{id: String(customerId), name: 'Cara Lane'}]);
    expect((await staff.get(`${BASE}/names?kind=product&ids=wool-jumper`)).json).toEqual([{id: 'wool-jumper', name: 'Wool jumper'}]);
  });
});
