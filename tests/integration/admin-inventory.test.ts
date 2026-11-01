import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** `/site-api/manage/inventory` (WP-18) against Postgres: list, filters, keyset pages, set / adjust, bulk. */

type Row = {variantId: string; productId: string; inventory: number; state: string; productName: string; image: unknown};
type Page = {items: Row[]; nextCursor: string | null};

async function seedCatalog() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}, select: {id: true}});
  const cat = await db.category.create({data: {name: 'Shirts', slug: 'shirts', departmentId: dept.id}, select: {id: true}});
  const product = (id: string, position: number, extra: Record<string, unknown> = {}) =>
    db.product.create({
      data: {
        id,
        name: id.replace(/-/g, ' '),
        brand: 'Varel',
        priceCents: 9000,
        sku: `VRL-${id.toUpperCase()}`,
        short: '',
        description: '',
        material: '',
        position,
        departmentId: dept.id,
        categoryId: cat.id,
        ...extra,
      },
    });
  await product('linen-shirt', 1);
  await product('wool-coat', 0);
  await product('field-guide', 2, {type: 'digital', download: 'guide.pdf'});
  await product('old-tee', 3, {status: 'archived'});
  await db.productImage.create({data: {productId: 'linen-shirt', key: 'a', src: 'https://images.unsplash.com/photo-1', position: 0}});
  const v = (id: string, productId: string, position: number, inventory: number | null, color: string | null, size: string | null) =>
    db.variant.create({data: {id, productId, position, inventory, color, size, priceCents: 9000}});
  await v('LS-STO-S', 'linen-shirt', 0, 0, 'Stone', 'S');
  await v('LS-STO-M', 'linen-shirt', 1, 3, 'Stone', 'M');
  await v('LS-STO-XL', 'linen-shirt', 2, 12, 'Stone', 'XL');
  await v('LS-BLA-M', 'linen-shirt', 3, 5, 'Black', 'M');
  await v('WC-CAM-M', 'wool-coat', 0, 20, 'Camel', 'M');
  await v('WC-CAM-L', 'wool-coat', 1, 7, 'Camel', 'L');
  await v('FG-PDF', 'field-guide', 0, null, null, null);
  await v('OT-WHI-M', 'old-tee', 0, 4, 'White', 'M');
}

describe.skipIf(!DATABASE_URL)('inventory admin (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    await seedCatalog();
  });

  it('lists physical, non-archived variants in product then variant order, no-store', async () => {
    const res = await staff.get('/site-api/manage/inventory');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const page = res.json as unknown as Page;
    expect(page.items.map(r => r.variantId)).toEqual(['WC-CAM-M', 'WC-CAM-L', 'LS-STO-S', 'LS-STO-M', 'LS-STO-XL', 'LS-BLA-M']);
    expect(page.nextCursor).toBeNull();
    const first = page.items.find(r => r.variantId === 'LS-STO-S')!;
    expect(first).toMatchObject({productId: 'linen-shirt', inventory: 0, state: 'out', color: 'Stone', size: 'S'});
    expect(first.image).toMatchObject({src: 'https://images.unsplash.com/photo-1'});
  });

  it('pages with a keyset cursor without repeats or gaps', async () => {
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 5; i++) {
      const page = (await staff.get(`/site-api/manage/inventory?pageSize=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`))
        .json as unknown as Page;
      seen.push(...page.items.map(r => r.variantId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['WC-CAM-M', 'WC-CAM-L', 'LS-STO-S', 'LS-STO-M', 'LS-STO-XL', 'LS-BLA-M']);
  });

  it('filters by state with the store threshold, and by search words', async () => {
    const ids = async (qs: string) => ((await staff.get(`/site-api/manage/inventory?${qs}`)).json as unknown as Page).items.map(r => r.variantId);
    expect(await ids('state=low')).toEqual(['LS-STO-M', 'LS-BLA-M']);
    expect(await ids('state=out,in')).toEqual(['WC-CAM-M', 'WC-CAM-L', 'LS-STO-S', 'LS-STO-XL']);
    await db.setting.update({where: {id: 1}, data: {lowStockThreshold: 3}});
    expect(await ids('state=low')).toEqual(['LS-STO-M']);
    expect(await ids('q=linen%20stone')).toEqual(['LS-STO-S', 'LS-STO-M', 'LS-STO-XL']);
    // Size matches exactly: "M" is not "XL".
    expect(await ids('q=m%20stone')).toEqual(['LS-STO-M']);
    expect((await staff.get('/site-api/manage/inventory?state=foo')).status).toBe(422);
  });

  it('guards: guests 401, customers 403', async () => {
    expect((await new Browser(app).get('/site-api/manage/inventory')).status).toBe(401);
    expect((await customer.get('/site-api/manage/inventory')).status).toBe(403);
    expect((await customer.request('PATCH', '/site-api/manage/inventory/LS-STO-M', {inventory: 1})).status).toBe(403);
    expect((await customer.post('/site-api/manage/inventory/bulk', {updates: [{variantId: 'LS-STO-M', inventory: 1}]})).status).toBe(403);
  });

  it('sets and adjusts a count, touching the product', async () => {
    const before = await db.product.findUniqueOrThrow({where: {id: 'linen-shirt'}, select: {updatedAt: true}});
    const set = await staff.request('PATCH', '/site-api/manage/inventory/LS-STO-M', {inventory: 9});
    expect(set.status).toBe(200);
    expect(set.json).toMatchObject({variantId: 'LS-STO-M', inventory: 9, state: 'in'});
    const after = await db.product.findUniqueOrThrow({where: {id: 'linen-shirt'}, select: {updatedAt: true}});
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    const down = await staff.request('PATCH', '/site-api/manage/inventory/LS-STO-M', {adjust: -999});
    expect(down.json).toMatchObject({inventory: 0, state: 'out'});
    expect((await staff.request('PATCH', '/site-api/manage/inventory/LS-STO-M', {inventory: 1, adjust: 1})).status).toBe(422);
  });

  it('refuses digital and unknown variants', async () => {
    const digital = await staff.request('PATCH', '/site-api/manage/inventory/FG-PDF', {inventory: 3});
    expect(digital.status).toBe(422);
    expect(digital.json.fields).toEqual({variantId: 'Digital products have no stock to track'});
    expect((await staff.request('PATCH', '/site-api/manage/inventory/NOPE-1', {inventory: 3})).status).toBe(404);
  });

  it('adjustments do not lose updates when they race', async () => {
    await Promise.all(Array.from({length: 10}, () => staff.request('PATCH', '/site-api/manage/inventory/WC-CAM-L', {adjust: 1})));
    expect((await db.variant.findUniqueOrThrow({where: {id: 'WC-CAM-L'}})).inventory).toBe(17);
  });

  it('bulk: all or nothing, last update of a SKU wins', async () => {
    const bad = await staff.post('/site-api/manage/inventory/bulk', {
      updates: [
        {variantId: 'LS-STO-S', inventory: 4},
        {variantId: 'FG-PDF', inventory: 2},
        {variantId: 'NOPE', inventory: 2},
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.json.fields).toEqual({
      'updates.1.variantId': 'Digital products have no stock to track',
      'updates.2.variantId': 'We cannot find that variant',
    });
    expect((await db.variant.findUniqueOrThrow({where: {id: 'LS-STO-S'}})).inventory).toBe(0);

    const ok = await staff.post('/site-api/manage/inventory/bulk', {
      updates: [
        {variantId: 'LS-STO-S', inventory: 4},
        {variantId: 'WC-CAM-M', inventory: 1},
        {variantId: 'LS-STO-S', inventory: 6},
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({updated: 2});
    const rows = await db.variant.findMany({where: {id: {in: ['LS-STO-S', 'WC-CAM-M']}}, select: {id: true, inventory: true}, orderBy: {id: 'asc'}});
    expect(rows).toEqual([
      {id: 'LS-STO-S', inventory: 6},
      {id: 'WC-CAM-M', inventory: 1},
    ]);
  });
});
