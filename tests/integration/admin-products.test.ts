import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** Products admin (WP-17): `/site-api/manage/products`, against Postgres. */
describe.skipIf(!DATABASE_URL)('products admin (integration, real Postgres)', () => {
  let staff: Browser;
  let customer: Browser;
  const FILE = 'file_0123456789abcdefghijklmnop';

  const product = (over: Record<string, unknown> = {}) => ({
    name: 'Linen Camp Shirt',
    brand: 'VAREL',
    dept: 'Women',
    category: 'Shirts',
    type: 'physical',
    status: 'published',
    price: 120,
    sku: 'VRL-LCS',
    images: [{src: 'https://images.unsplash.com/photo-1', credit: 'Photo', creditHref: 'https://unsplash.com'}],
    variants: [
      {id: 'VRL-LCS-S', color: 'Stone', size: 'S', swatch: '#CFC8BE', price: 120, inventory: 3},
      {id: 'VRL-LCS-M', color: 'Stone', size: 'M', swatch: '#CFC8BE', price: 120, inventory: 10},
    ],
    options: [
      {kind: 'color', name: 'Colour', values: ['Stone']},
      {kind: 'size', name: 'Size', values: ['S', 'M']},
    ],
    ...over,
  });

  const create = async (over: Record<string, unknown> = {}) => {
    const res = await staff.request('POST', '/site-api/manage/products', product(over));
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json as {id: string; sku: string; variants: {id: string; inventory: number | null}[]; images: {src: string}[]};
  };

  const order = async (productId: string) => {
    const o = await db.shopOrder.create({
      data: {number: `V${Date.now()}${Math.floor(Math.random() * 1000)}`, email: 'guest@example.com', method: 'Standard', subtotalCents: 12000, totalCents: 12000},
      select: {id: true},
    });
    await db.shopOrderItem.create({
      data: {orderId: o.id, productId, name: 'x', category: 'Shirts', sku: 'X', qty: 1, priceCents: 12000, image: {}},
    });
  };

  // Signing in costs three password hashes: once for the file; each test starts from an empty catalog.
  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    const owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    const women = await db.department.create({data: {name: 'Women', slug: 'women', position: 0}, select: {id: true}});
    const men = await db.department.create({data: {name: 'Men', slug: 'men', position: 1}, select: {id: true}});
    await db.category.createMany({
      data: [
        {name: 'Shirts', slug: 'shirts', departmentId: women.id},
        {name: 'Knitwear', slug: 'knitwear', departmentId: women.id},
        {name: 'Shirts', slug: 'shirts', departmentId: men.id},
      ],
    });
  }, 180_000);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "media_uploads", "products", "product_images", "variants", "carts", "cart_lines", "shop_orders", "shop_order_items" RESTART IDENTITY CASCADE'
    );
  });

  it('guards: guests 401, customers 403, staff 200', async () => {
    expect((await new Browser(app).get('/site-api/manage/products')).status).toBe(401);
    expect((await customer.get('/site-api/manage/products')).status).toBe(403);
    const res = await staff.get('/site-api/manage/products');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({items: [], nextCursor: null});
  });

  it('creates a product with variants, images and options; reads it back', async () => {
    const p = await create();
    expect(p.id).toBe('linen-camp-shirt');
    const got = await staff.get(`/site-api/manage/products/${p.id}`);
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({
      id: 'linen-camp-shirt',
      dept: 'Women',
      category: 'Shirts',
      status: 'published',
      price: 120,
      inventory: 13,
      stock: 'in',
      variantCount: 2,
      orderCount: 0,
      options: [
        {kind: 'color', name: 'Colour', values: ['Stone']},
        {kind: 'size', name: 'Size', values: ['S', 'M']},
      ],
    });
    expect((got.json.images as {fileId: unknown}[])[0]?.fileId).toBeNull();
    const draft = await create({name: 'Wool Scarf', sku: 'VRL-WS', status: undefined, variants: [{id: 'VRL-WS', color: null, size: null, swatch: null, price: 60, inventory: 1}], options: []});
    expect((await staff.get(`/site-api/manage/products/${draft.id}`)).json.status).toBe('draft');
  });

  it('refuses taken slugs and SKUs, unknown taxonomy and unconfirmed uploads', async () => {
    await create();
    const slug = await staff.request('POST', '/site-api/manage/products', product({sku: 'OTHER', variants: [{id: 'OTHER-1', color: null, size: null, swatch: null, price: 1, inventory: 1}]}));
    expect(slug.status).toBe(409);
    expect(slug.json.fields).toHaveProperty('id');

    const sku = await staff.request(
      'POST',
      '/site-api/manage/products',
      product({
        name: 'Other',
        sku: 'NEW-SKU',
        variants: [
          {id: 'NEW-1', color: null, size: 'S', swatch: null, price: 1, inventory: 1},
          {id: 'VRL-LCS-M', color: null, size: 'M', swatch: null, price: 1, inventory: 1},
          {id: 'NEW-1', color: null, size: 'L', swatch: null, price: 1, inventory: 1},
        ],
      })
    );
    expect(sku.status).toBe(409);
    expect(sku.json.fields).toHaveProperty(['variants.1.id']);
    expect(sku.json.fields).toHaveProperty(['variants.2.id']);

    const dept = await staff.request('POST', '/site-api/manage/products', product({name: 'Nope', sku: 'NOPE', dept: 'Kids', variants: [{id: 'NOPE', color: null, size: null, swatch: null, price: 1, inventory: 1}]}));
    expect(dept.status).toBe(422);
    expect(dept.json.fields).toHaveProperty('dept');

    const img = await staff.request(
      'POST',
      '/site-api/manage/products',
      product({name: 'Img', sku: 'IMG', images: [{src: `/__platform/files/${FILE}/a.webp`}], variants: [{id: 'IMG', color: null, size: null, swatch: null, price: 1, inventory: 1}]})
    );
    expect(img.status).toBe(422);
    expect(img.json.fields).toHaveProperty(['images.0.src']);

    await db.mediaUpload.create({data: {fileId: FILE, name: 'a.webp', contentType: 'image/webp', size: 10, ready: true, url: `/__platform/files/${FILE}/a.webp`}});
    const ok = await staff.request(
      'POST',
      '/site-api/manage/products',
      product({name: 'Img', sku: 'IMG', images: [{src: `/__platform/files/${FILE}/a.webp`}], variants: [{id: 'IMG', color: null, size: null, swatch: null, price: 1, inventory: 1}]})
    );
    expect(ok.status).toBe(201);
    expect((ok.json.images as {fileId: string}[])[0]?.fileId).toBe(FILE);
  });

  it('lists with filters, search, stock states and keyset pages', async () => {
    await create();
    await create({name: 'Wool Scarf', sku: 'VRL-WS', dept: 'Men', category: 'Shirts', price: 60, status: 'draft', variants: [{id: 'VRL-WS-1', color: null, size: null, swatch: null, price: 60, inventory: 0}], options: []});
    await create({name: 'Pattern Guide', sku: 'VRL-PG', type: 'digital', download: 'guide.pdf', price: 15, variants: [{id: 'VRL-PG', color: null, size: null, swatch: null, price: 15, inventory: null}], options: [], images: []});
    await create({name: 'Knit Vest', sku: 'VRL-KV', category: 'Knitwear', price: 90, variants: [{id: 'VRL-KV-1', color: null, size: null, swatch: null, price: 90, inventory: 2}], options: []});

    const names = async (qs: string) => {
      const res = await staff.get(`/site-api/manage/products${qs}`);
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      return (res.json.items as {name: string}[]).map(i => i.name);
    };
    expect(await names('?sort=name')).toEqual(['Knit Vest', 'Linen Camp Shirt', 'Pattern Guide', 'Wool Scarf']);
    expect(await names('?q=camp%20shirt')).toEqual(['Linen Camp Shirt']);
    expect(await names('?q=vrl-lcs-m')).toEqual(['Linen Camp Shirt']);
    expect(await names('?status=draft')).toEqual(['Wool Scarf']);
    expect(await names('?dept=men')).toEqual(['Wool Scarf']);
    expect(await names('?dept=Women&category=Knitwear')).toEqual(['Knit Vest']);
    expect(await names('?stock=out,low&sort=name')).toEqual(['Knit Vest', 'Wool Scarf']);
    expect(await names('?stock=digital')).toEqual(['Pattern Guide']);
    expect(await names('?sort=-price')).toEqual(['Linen Camp Shirt', 'Knit Vest', 'Wool Scarf', 'Pattern Guide']);
    expect(await names('?sort=inventory')).toEqual(['Wool Scarf', 'Knit Vest', 'Linen Camp Shirt', 'Pattern Guide']);
    expect(await names('?sort=-inventory')).toEqual(['Linen Camp Shirt', 'Knit Vest', 'Wool Scarf', 'Pattern Guide']);

    expect((await staff.get('/site-api/manage/products?sort=bogus')).status).toBe(422);
    expect((await staff.get('/site-api/manage/products?status=gone')).status).toBe(422);

    for (const sort of ['name', '-updatedAt', 'inventory', '-inventory', 'price']) {
      const seen: string[] = [];
      let cursor = '';
      for (let i = 0; i < 5; i++) {
        const res = await staff.get(`/site-api/manage/products?sort=${sort}&pageSize=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.status).toBe(200);
        seen.push(...(res.json.items as {id: string}[]).map(r => r.id));
        if (!res.json.nextCursor) break;
        cursor = res.json.nextCursor as string;
      }
      expect(new Set(seen).size, sort).toBe(4);
      expect(seen.length, sort).toBe(4);
    }
  });

  it('patches: slug fixed, variants replaced, type changes, images replaced', async () => {
    const p = await create();
    const cart = await db.cart.create({data: {}, select: {id: true}});
    await db.cartLine.create({data: {cartId: cart.id, productId: p.id, variantId: 'VRL-LCS-S', qty: 1}});
    expect(await db.cartLine.count({where: {variantId: 'VRL-LCS-S'}})).toBe(1);

    expect((await staff.request('PATCH', `/site-api/manage/products/${p.id}`, {id: 'other'})).status).toBe(422);

    const before = await db.product.findUnique({where: {id: p.id}, select: {updatedAt: true}});
    const res = await staff.request('PATCH', `/site-api/manage/products/${p.id}`, {
      variants: [
        {id: 'VRL-LCS-M', color: 'Stone', size: 'M', swatch: '#CFC8BE', price: 125, inventory: 4},
        {id: 'VRL-LCS-L', color: 'Stone', size: 'L', swatch: '#CFC8BE', price: 120, inventory: 1},
      ],
      images: [{src: 'https://images.unsplash.com/photo-2'}],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect((res.json.variants as {id: string}[]).map(v => v.id)).toEqual(['VRL-LCS-M', 'VRL-LCS-L']);
    expect((res.json.images as {src: string}[]).map(i => i.src)).toEqual(['https://images.unsplash.com/photo-2']);
    expect(await db.variant.count({where: {id: 'VRL-LCS-S'}})).toBe(0);
    expect(await db.cartLine.count({where: {variantId: 'VRL-LCS-S'}})).toBe(0);
    const after = await db.product.findUnique({where: {id: p.id}, select: {updatedAt: true}});
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());

    const digital = await staff.request('PATCH', `/site-api/manage/products/${p.id}`, {type: 'digital', download: 'guide.pdf'});
    expect(digital.status, JSON.stringify(digital.json)).toBe(200);
    expect((digital.json.variants as {inventory: number | null}[]).every(v => v.inventory === null)).toBe(true);

    expect((await staff.request('PATCH', `/site-api/manage/products/${p.id}`, {compareAt: 10})).status).toBe(422);
  });

  it('locks the type of an ordered product and archives instead of deleting it', async () => {
    const ordered = await create();
    const free = await create({name: 'Wool Scarf', sku: 'VRL-WS', variants: [{id: 'VRL-WS-1', color: null, size: null, swatch: null, price: 60, inventory: 1}], options: []});
    await order(ordered.id);

    expect((await staff.get(`/site-api/manage/products/${ordered.id}`)).json.orderCount).toBe(1);
    const type = await staff.request('PATCH', `/site-api/manage/products/${ordered.id}`, {type: 'digital', download: 'a.pdf'});
    expect(type.status).toBe(422);
    expect(type.json.fields).toHaveProperty('type');

    const archived = await staff.request('DELETE', `/site-api/manage/products/${ordered.id}`);
    expect(archived.status).toBe(200);
    expect(archived.json).toEqual({archived: true});
    expect((await db.product.findUnique({where: {id: ordered.id}, select: {status: true}}))?.status).toBe('archived');

    const gone = await staff.request('DELETE', `/site-api/manage/products/${free.id}`);
    expect(gone.status).toBe(204);
    expect(await db.product.count({where: {id: free.id}})).toBe(0);
    expect(await db.variant.count({where: {productId: free.id}})).toBe(0);

    const missing = await staff.get('/site-api/manage/products/no-such-product');
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({error: 'not_found'});
  });

  it('duplicates as a draft with -copy names', async () => {
    const p = await create({featured: true, allowBackorder: true});
    const one = await staff.request('POST', `/site-api/manage/products/${p.id}/duplicate`, {});
    expect(one.status, JSON.stringify(one.json)).toBe(201);
    expect(one.json).toMatchObject({id: 'linen-camp-shirt-copy', sku: 'VRL-LCS-COPY', status: 'draft', name: 'Linen Camp Shirt (copy)', featured: false, allowBackorder: false});
    expect((one.json.variants as {id: string}[]).map(v => v.id)).toEqual(['VRL-LCS-S-COPY', 'VRL-LCS-M-COPY']);
    expect((one.json.images as unknown[]).length).toBe(1);
    const two = await staff.request('POST', `/site-api/manage/products/${p.id}/duplicate`, {});
    expect(two.json).toMatchObject({id: 'linen-camp-shirt-copy-2', sku: 'VRL-LCS-COPY-2'});
    expect((two.json.variants as {id: string}[]).map(v => v.id)).toEqual(['VRL-LCS-S-COPY-2', 'VRL-LCS-M-COPY-2']);
  });
});
