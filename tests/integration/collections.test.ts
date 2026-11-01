import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import type {CollectionDetail, CollectionSummary} from '../../src/lib/types/collections';
import type {AdminCollection, AdminCollectionRow, CategoryOrder} from '../../src/lib/types/admin/merchandising';
import {app} from '../../src/server/app';
import {invalidateLocaleSettings} from '../../src/server/lib/locale';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** WP-05 Collections: the public routes (`/site-api/collections`) and the admin (`/site-api/manage/collections`). */

interface Fixture {
  id: string;
  cat: number;
  position: number;
  categoryPosition: number;
  status?: string;
  inventory?: number;
}

const PRODUCTS: Fixture[] = [
  {id: 'forma-overshirt', cat: 1, position: 1, categoryPosition: 2},
  {id: 'linen-shirt', cat: 1, position: 2, categoryPosition: 1},
  {id: 'sold-knit', cat: 1, position: 3, categoryPosition: 0, inventory: 0},
  {id: 'draft-shirt', cat: 1, position: 4, categoryPosition: 3, status: 'draft'},
  {id: 'old-shirt', cat: 1, position: 5, categoryPosition: 4, status: 'archived'},
  {id: 'wool-dress', cat: 2, position: 6, categoryPosition: 0},
];

async function seed() {
  await db.department.create({data: {id: 1, name: 'Women', slug: 'women', position: 0}});
  await db.category.createMany({
    data: [
      {id: 1, name: 'Shirts', slug: 'shirts', position: 0, departmentId: 1},
      {id: 2, name: 'Dresses', slug: 'dresses', position: 1, departmentId: 1},
    ],
  });
  for (const p of PRODUCTS) {
    await db.product.create({
      data: {
        id: p.id,
        name: p.id.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' '),
        brand: 'VAREL',
        status: p.status ?? 'published',
        priceCents: 12000,
        sku: `SKU-${p.id}`,
        short: `${p.id} short`,
        description: `${p.id} description`,
        material: 'Linen',
        tags: [],
        position: p.position,
        categoryPosition: p.categoryPosition,
        departmentId: 1,
        categoryId: p.cat,
        images: {create: [{key: p.id, src: `https://images.example.test/${p.id}.jpg`, position: 0}]},
        variants: {create: [{id: `${p.id}-0`, color: 'Stone', size: 'M', priceCents: 12000, inventory: p.inventory ?? 5, position: 0}]},
      },
    });
  }
  await db.collection.create({
    data: {
      id: 1,
      slug: 'the-autumn-edit',
      title: 'The autumn edit',
      description: '<p>Layers for the turn of the season.</p>',
      featuredOnHome: true,
      position: 0,
      products: {create: [{productId: 'forma-overshirt', position: 0}, {productId: 'draft-shirt', position: 1}]},
    },
  });
  await db.collection.create({
    data: {
      id: 2,
      slug: 'travel-light',
      title: 'Travel light',
      featuredOnHome: false,
      position: 1,
      products: {
        create: [
          {productId: 'linen-shirt', position: 0},
          {productId: 'sold-knit', position: 1},
          {productId: 'forma-overshirt', position: 2},
          {productId: 'draft-shirt', position: 3},
        ],
      },
    },
  });
  await db.collection.create({data: {id: 3, slug: 'hidden-edit', title: 'Hidden edit', published: false, position: 2}});
  // Ids 1..3 were set by hand: move the sequence past them.
  await db.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('collections', 'id'), 3)`);
  await db.translation.create({
    data: {entity: 'collection', entityId: '2', field: 'title', locale: 'da', value: 'Rejs let', sourceHash: 'x'},
  });
}

const guest = () => new Browser(app);

describe.skipIf(!DATABASE_URL)('collections (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    invalidateLocaleSettings();
    await seed();
  });

  describe('public', () => {
    it('lists published collections in order, featured filter, translated, cached', async () => {
      const res = await guest().get('/site-api/collections');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('max-age=300');
      const list = res.json as unknown as CollectionSummary[];
      expect(list.map(c => c.slug)).toEqual(['the-autumn-edit', 'travel-light']);
      expect(list[0]).toMatchObject({productCount: 1, featuredOnHome: true, image: {src: 'https://images.example.test/forma-overshirt.jpg'}});
      expect(list[1]!.productCount).toBe(3);

      const featured = (await guest().get('/site-api/collections?featured=true')).json as unknown as CollectionSummary[];
      expect(featured.map(c => c.slug)).toEqual(['the-autumn-edit']);

      const da = await guest().request('GET', '/site-api/collections', undefined, {'x-locale': 'da'});
      expect((da.json as unknown as CollectionSummary[])[1]!.title).toBe('Rejs let');

      const bad = await guest().get('/site-api/collections?featured=maybe');
      expect(bad.status).toBe(422);
      expect(bad.json).toMatchObject({error: 'invalid_input', fields: {featured: 'Use featured=true or featured=false'}});
    });

    it('answers a collection with its published products in curated order', async () => {
      const res = await guest().get('/site-api/collections/travel-light');
      expect(res.status).toBe(200);
      const c = res.json as unknown as CollectionDetail;
      // The sold-out piece stays, the draft drops.
      expect(c.products.map(p => p.id)).toEqual(['linen-shirt', 'sold-knit', 'forma-overshirt']);
      expect(c.productCount).toBe(3);

      await db.product.update({where: {id: 'linen-shirt'}, data: {status: 'draft'}});
      const after = (await guest().get('/site-api/collections/travel-light')).json as unknown as CollectionDetail;
      expect(after.products.map(p => p.id)).toEqual(['sold-knit', 'forma-overshirt']);
      expect(after.productCount).toBe(2);

      expect((await guest().get('/site-api/collections/TRAVEL-LIGHT')).status).toBe(200);
    });

    it('hides unknown, unpublished and impossible slugs (404)', async () => {
      for (const path of ['nope', 'hidden-edit', 'bad--slug']) {
        const res = await guest().get(`/site-api/collections/${path}`);
        expect(res.status).toBe(404);
        expect(res.json).toMatchObject({error: 'not_found'});
      }
    });

    it('lists published collections for the sitemap', async () => {
      const res = await guest().get('/site-api/collections/sitemap');
      expect(res.status).toBe(200);
      const items = (res.json as {items: {path: string; updatedAt: string}[]}).items;
      expect(items.map(i => i.path)).toEqual(['/collections/the-autumn-edit/', '/collections/travel-light/']);
      expect(Number.isNaN(Date.parse(items[0]!.updatedAt))).toBe(false);
    });
  });

  describe('admin', () => {
    let owner: Browser;

    beforeEach(async () => {
      owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
      const admin = await db.role.findUniqueOrThrow({where: {slug: 'admin'}, select: {id: true}});
      await db.userRole.create({data: {userId: await userId('owner@example.test'), roleId: admin.id}});
    });

    it('guards: guests 401, customers 403, discount staff read only', async () => {
      expect((await guest().get('/site-api/manage/collections')).status).toBe(401);
      const customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.22');
      expect((await customer.get('/site-api/manage/collections')).status).toBe(403);

      const promo = await signedIn(app, 'promo@example.test', undefined, '203.0.113.23');
      const permission = await db.permission.findUniqueOrThrow({where: {codename: 'site:discount:manage'}, select: {id: true}});
      const role = await db.role.create({data: {slug: 'promo', name: 'Promotions', permissions: {create: [{permissionId: permission.id}]}}});
      await db.userRole.create({data: {userId: await userId('promo@example.test'), roleId: role.id}});
      expect((await promo.get('/site-api/manage/collections')).status).toBe(200);
      expect((await promo.get('/site-api/manage/collections/1')).status).toBe(200);
      expect((await promo.post('/site-api/manage/collections', {title: 'No'})).status).toBe(403);
      expect((await promo.request('PATCH', '/site-api/manage/collections/1', {published: false})).status).toBe(403);
      expect((await promo.delete('/site-api/manage/collections/1')).status).toBe(403);
    });

    it('lists every collection with all its links counted', async () => {
      const res = await owner.get('/site-api/manage/collections');
      expect(res.status).toBe(200);
      const rows = res.json as unknown as AdminCollectionRow[];
      expect(rows.map(r => [r.id, r.slug, r.productCount, r.published])).toEqual([
        ['1', 'the-autumn-edit', 2, true],
        ['2', 'travel-light', 4, true],
        ['3', 'hidden-edit', 0, false],
      ]);
    });

    it('creates with defaults, refuses taken slugs and unknown products', async () => {
      const res = await owner.post('/site-api/manage/collections', {title: 'Summer Days', productIds: ['wool-dress', 'linen-shirt']});
      expect(res.status).toBe(201);
      const c = res.json as unknown as AdminCollection;
      expect(c).toMatchObject({slug: 'summer-days', published: true, featuredOnHome: false, position: 3, productCount: 2, seoTitle: null});
      expect(c.products.map(p => p.id)).toEqual(['wool-dress', 'linen-shirt']);
      expect(c.products[0]).toMatchObject({dept: 'Women', category: 'Dresses', price: 120, inventory: 5});

      const taken = await owner.post('/site-api/manage/collections', {title: 'Again', slug: 'travel-light'});
      expect(taken.status).toBe(409);
      expect(taken.json).toMatchObject({error: 'slug_taken', fields: {slug: 'Choose another slug'}});

      const unknown = await owner.post('/site-api/manage/collections', {title: 'Unknown', productIds: ['nope']});
      expect(unknown.status).toBe(422);
      expect(unknown.json).toMatchObject({fields: {productIds: 'We cannot find nope'}});

      const many = await owner.post('/site-api/manage/collections', {title: 'Many', productIds: Array.from({length: 101}, (_, i) => `p${i}`)});
      expect(many.status).toBe(422);
    });

    it('updates only what was sent; product list replaced; image cleared', async () => {
      await db.collection.update({where: {id: 2}, data: {image: {src: 'https://images.example.test/own.jpg', credit: '', creditHref: ''}}});
      const keep = await owner.request('PATCH', '/site-api/manage/collections/2', {featuredOnHome: true});
      expect(keep.status).toBe(200);
      expect(keep.json).toMatchObject({title: 'Travel light', featuredOnHome: true, image: {src: 'https://images.example.test/own.jpg'}});

      const replaced = await owner.request('PATCH', '/site-api/manage/collections/2', {productIds: ['wool-dress', 'linen-shirt'], image: null});
      const c = replaced.json as unknown as AdminCollection;
      expect(c.products.map(p => p.id)).toEqual(['wool-dress', 'linen-shirt']);
      expect(c.image).toBeNull();

      expect((await owner.request('PATCH', '/site-api/manage/collections/2', {slug: 'travel-light'})).status).toBe(200);
      expect((await owner.request('PATCH', '/site-api/manage/collections/2', {slug: 'the-autumn-edit'})).status).toBe(409);
      expect((await owner.request('PATCH', '/site-api/manage/collections/abc', {published: false})).status).toBe(404);
      expect((await owner.get('/site-api/manage/collections/999')).status).toBe(404);
    });

    it('reorders collections; refuses missing ids', async () => {
      const res = await owner.request('PATCH', '/site-api/manage/collections/order', {ids: ['3', '2', '1']});
      expect(res.status).toBe(200);
      expect((res.json as unknown as AdminCollectionRow[]).map(r => r.slug)).toEqual(['hidden-edit', 'travel-light', 'the-autumn-edit']);
      const missing = await owner.request('PATCH', '/site-api/manage/collections/order', {ids: ['1', '42']});
      expect(missing.status).toBe(422);
      expect(missing.json).toMatchObject({fields: {ids: 'One or more collections no longer exist. Reload and try again'}});
      expect((await owner.request('PATCH', '/site-api/manage/collections/order', {ids: []})).status).toBe(422);
    });

    it('reads and writes the manual order inside a category', async () => {
      const res = await owner.get('/site-api/manage/collections/category-order?category=1');
      expect(res.status).toBe(200);
      const order = res.json as unknown as CategoryOrder;
      expect(order.category).toMatchObject({id: '1', name: 'Shirts', slug: 'shirts', dept: 'Women', deptSlug: 'women'});
      // Archived products are neither shown nor orderable.
      expect(order.products.map(p => p.id)).toEqual(['sold-knit', 'linen-shirt', 'forma-overshirt', 'draft-shirt']);

      const foreign = await owner.request('PATCH', '/site-api/manage/collections/product-order', {category: '1', productIds: ['wool-dress']});
      expect(foreign.status).toBe(422);
      expect(foreign.json).toMatchObject({fields: {productIds: 'Not in this category: wool-dress'}});

      const saved = await owner.request('PATCH', '/site-api/manage/collections/product-order', {
        category: '1',
        productIds: ['forma-overshirt', 'linen-shirt', 'draft-shirt', 'sold-knit'],
      });
      expect(saved.status).toBe(200);
      expect((saved.json as unknown as CategoryOrder).products.map(p => p.id)).toEqual(['forma-overshirt', 'linen-shirt', 'draft-shirt', 'sold-knit']);
      expect((await db.product.findUniqueOrThrow({where: {id: 'sold-knit'}, select: {categoryPosition: true}})).categoryPosition).toBe(3);

      expect((await owner.get('/site-api/manage/collections/category-order?category=99')).status).toBe(404);
      expect((await owner.get('/site-api/manage/collections/category-order')).status).toBe(422);
    });

    it('deletes a collection, keeps its products', async () => {
      const res = await owner.delete('/site-api/manage/collections/2');
      expect(res.status).toBe(204);
      expect(await db.collectionProduct.count({where: {collectionId: 2}})).toBe(0);
      expect(await db.product.count({where: {id: 'linen-shirt'}})).toBe(1);
      expect((await owner.delete('/site-api/manage/collections/2')).status).toBe(404);
    });
  });
});
