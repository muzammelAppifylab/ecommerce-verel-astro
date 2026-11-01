import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/** WP-03: GET /site-api/products/:slug, /:slug/related, /sitemap against Postgres (routes/product.ts). */

type Json = Record<string, unknown>;

async function seedCatalog() {
  const women = await db.department.create({data: {name: 'Women', slug: 'women', position: 1}});
  const men = await db.department.create({data: {name: 'Men', slug: 'men', position: 2}});
  const objects = await db.department.create({data: {name: 'Objects', slug: 'objects', position: 3}});
  const wShirts = await db.category.create({data: {name: 'Shirts', slug: 'shirts', departmentId: women.id}});
  const wKnit = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: women.id}});
  const mShirts = await db.category.create({data: {name: 'Shirts', slug: 'mens-shirts', departmentId: men.id}});
  const mTrousers = await db.category.create({data: {name: 'Trousers', slug: 'trousers', departmentId: men.id}});
  const home = await db.category.create({data: {name: 'Home', slug: 'home', departmentId: objects.id}});

  const product = (
    id: string,
    position: number,
    departmentId: number,
    categoryId: number,
    extra: Record<string, unknown> = {}
  ) =>
    db.product.create({
      data: {
        id,
        name: id.replace(/-/g, ' '),
        brand: 'VAREL',
        priceCents: 14800,
        sku: `SKU-${id}`,
        short: `${id} short`,
        description: `## ${id}\n\nA considered piece.`,
        material: 'Linen',
        position,
        departmentId,
        categoryId,
        ...extra,
      },
    });

  await product('forma-overshirt', 1, women.id, wShirts.id, {
    seoTitle: 'Forma Overshirt in linen',
    seoDescription: 'The Forma overshirt, cut from washed linen.',
    tags: ['new'],
  });
  await db.productImage.createMany({
    data: [
      {productId: 'forma-overshirt', key: 'a', src: 'https://images.unsplash.com/photo-a', position: 0},
      {productId: 'forma-overshirt', key: 'b', src: 'https://images.unsplash.com/photo-b', position: 1},
    ],
  });
  await db.variant.createMany({
    data: [
      {id: 'FO-STONE-M', productId: 'forma-overshirt', color: 'Stone', size: 'M', swatch: '#CFC8BE', priceCents: 14800, inventory: 4, position: 2},
      {id: 'FO-STONE-S', productId: 'forma-overshirt', color: 'Stone', size: 'S', swatch: '#CFC8BE', priceCents: 14800, inventory: 0, position: 1},
      {id: 'FO-BLACK-M', productId: 'forma-overshirt', color: 'Black', size: 'M', swatch: '#1A1A1A', priceCents: 15800, inventory: 2, position: 3},
    ],
  });
  await product('draft-piece', 2, women.id, wShirts.id, {status: 'draft'});
  await product('archived-piece', 3, women.id, wShirts.id, {status: 'archived'});
  await product('mens-shirt', 4, men.id, mShirts.id); // same category name, other department
  await product('knit-sweater', 5, women.id, wKnit.id); // same department
  await product('sold-out-knit', 6, women.id, wKnit.id); // same department, nothing on hand
  await db.variant.create({data: {id: 'SOK-1', productId: 'sold-out-knit', size: 'M', priceCents: 14800, inventory: 0}});
  await db.variant.create({data: {id: 'KS-1', productId: 'knit-sweater', size: 'M', priceCents: 14800, inventory: 5}});
  await db.variant.create({data: {id: 'MS-1', productId: 'mens-shirt', size: 'M', priceCents: 14800, inventory: 5}});
  await product('wide-trouser', 7, men.id, mTrousers.id); // the rest
  await db.variant.create({data: {id: 'WT-1', productId: 'wide-trouser', size: 'M', priceCents: 14800, inventory: 5}});
  await product('stone-vase', 8, objects.id, home.id); // the rest
  await db.variant.create({data: {id: 'SV-1', productId: 'stone-vase', priceCents: 14800, inventory: 5}});

  await db.translation.createMany({
    data: [
      {entity: 'product', entityId: 'forma-overshirt', field: 'name', locale: 'da', value: 'Forma overskjorte', sourceHash: 'x'},
      {entity: 'category', entityId: String(wShirts.id), field: 'name', locale: 'da', value: 'Skjorter', sourceHash: 'x'},
      {entity: 'option', entityId: 'Stone', field: 'color', locale: 'da', value: 'Sten', sourceHash: 'x'},
    ],
  });
}

describe.skipIf(!DATABASE_URL)('product detail routes (integration, real Postgres)', () => {
  let guest: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    guest = new Browser(app);
  });

  it('GET /products/:slug answers the full Product, prices in units, variants by position', async () => {
    const res = await guest.get('/site-api/products/forma-overshirt');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    const p = res.json as Json & {variants: Json[]; gallery: Json[]; image: Json; swatches: Json[]};
    expect(p.id).toBe('forma-overshirt');
    expect(p.price).toBe(148);
    expect(p.dept).toBe('Women');
    expect(p.category).toBe('Shirts');
    expect(p.deptSlug).toBe('women');
    expect(p.categorySlug).toBe('shirts');
    expect(p.variants.map(v => v.id)).toEqual(['FO-STONE-S', 'FO-STONE-M', 'FO-BLACK-M']);
    expect(p.variants[2]!.price).toBe(158);
    expect(p.gallery[0]).toEqual(p.image);
    expect(p.gallery).toHaveLength(2);
    expect(p.swatches.map(s => s.name)).toEqual(['Stone', 'Black']);
    expect(p.seoTitle).toBe('Forma Overshirt in linen');
    expect(p.seoDescription).toBe('The Forma overshirt, cut from washed linen.');
    expect(p.badge).toBe('New');
    // Never on the wire: costs, weights, packages.
    expect(p).not.toHaveProperty('costCents');
    expect(p).not.toHaveProperty('weight');
  });

  it('drafts, archived, unknown and malformed slugs are 404 not_found (never 422)', async () => {
    for (const slug of ['draft-piece', 'archived-piece', 'no-such-piece', 'A%20B', 'Forma-Overshirt', 'x'.repeat(121)]) {
      const res = await guest.get(`/site-api/products/${slug}`);
      expect(res.status, slug).toBe(404);
      expect(res.json.error).toBe('not_found');
      expect(res.json.message).toBe('We cannot find that product');
    }
  });

  it('X-Locale: da translates the content and drops the English SEO overrides', async () => {
    const res = await guest.request('GET', '/site-api/products/forma-overshirt', undefined, {'x-locale': 'da'});
    expect(res.status).toBe(200);
    const p = res.json as Json & {swatches: Json[]; variants: Json[]};
    expect(p.name).toBe('Forma overskjorte');
    expect(p.categoryLabel).toBe('Skjorter');
    expect(p.category).toBe('Shirts');
    expect(p.swatches[0]).toMatchObject({name: 'Stone', label: 'Sten'});
    expect(p.variants[0]!.color).toBe('Stone');
    expect(p.seoTitle).toBeNull();
    expect(p.seoDescription).toBeNull();
  });

  it('related: same department or category name first, self excluded, then the rest', async () => {
    const res = await guest.get('/site-api/products/forma-overshirt/related');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    const ids = (res.json as unknown as Json[]).map(p => p.id);
    expect(ids).toEqual(['mens-shirt', 'knit-sweater', 'sold-out-knit', 'wide-trouser']);

    const all = await guest.get('/site-api/products/forma-overshirt/related?limit=24');
    expect((all.json as unknown as Json[]).map(p => p.id)).toEqual([
      'mens-shirt',
      'knit-sweater',
      'sold-out-knit',
      'wide-trouser',
      'stone-vase',
    ]);
  });

  it('related honours hideSoldOut', async () => {
    await db.setting.update({where: {id: 1}, data: {hideSoldOut: true}});
    const res = await guest.get('/site-api/products/forma-overshirt/related?limit=24');
    expect((res.json as unknown as Json[]).map(p => p.id)).toEqual(['mens-shirt', 'knit-sweater', 'wide-trouser', 'stone-vase']);
  });

  it('related: a bad limit is 422 with fields.limit; an unknown or draft slug is 404', async () => {
    for (const limit of ['0', '25', '1.5', 'abc']) {
      const res = await guest.get(`/site-api/products/forma-overshirt/related?limit=${limit}`);
      expect(res.status, limit).toBe(422);
      expect(res.json.error).toBe('invalid_input');
      expect((res.json.fields as Json).limit).toBe('Use a limit between 1 and 24');
    }
    expect((await guest.get('/site-api/products/no-such-piece/related')).status).toBe(404);
    expect((await guest.get('/site-api/products/draft-piece/related')).status).toBe(404);
  });

  it('GET /products/sitemap lists published products only, cached publicly', async () => {
    const res = await guest.get('/site-api/products/sitemap');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const items = res.json.items as {path: string; updatedAt: string}[];
    expect(items.map(i => i.path)).toEqual([
      '/product/forma-overshirt/',
      '/product/mens-shirt/',
      '/product/knit-sweater/',
      '/product/sold-out-knit/',
      '/product/wide-trouser/',
      '/product/stone-vase/',
    ]);
    expect(new Date(items[0]!.updatedAt).toISOString()).toBe(items[0]!.updatedAt);
  });
});
