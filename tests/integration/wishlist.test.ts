import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn} from './support/harness';

/** The wishlist routes (WP-10) against Postgres: guests by `visitor_id`, users by account. */
describe.skipIf(!DATABASE_URL)('wishlist (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());

  let deptId: number;
  let catId: number;

  async function product(id: string, opts: {status?: string; inventory?: (number | null)[]; backorder?: boolean} = {}) {
    await db.product.create({
      data: {
        id,
        name: `Piece ${id}`,
        brand: 'VAREL',
        status: opts.status ?? 'published',
        priceCents: 12_000,
        sku: `SKU-${id}`,
        short: 'A piece',
        description: 'A piece',
        material: 'Wool',
        allowBackorder: opts.backorder ?? false,
        departmentId: deptId,
        categoryId: catId,
        images: {create: [{key: `${id}-0`, src: 'https://images.unsplash.com/photo-1', position: 0}]},
        variants: {
          create: (opts.inventory ?? [5]).map((inventory, i) => ({
            id: `${id}-v${i}`,
            color: 'Stone',
            size: ['S', 'M', 'L'][i] ?? null,
            priceCents: 12_000,
            inventory,
            position: i,
          })),
        },
      },
    });
  }

  beforeEach(async () => {
    await resetDatabase();
    const dept = await db.department.create({data: {name: 'Women', slug: 'women'}});
    const cat = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: dept.id}});
    deptId = dept.id;
    catId = cat.id;
    await product('alpha');
    await product('beta', {inventory: [0]});
    await product('gamma', {inventory: [2]});
    await product('draft-one', {status: 'draft'});
  });

  it('a guest without a cookie reads an empty list without anything being created', async () => {
    const guest = new Browser(app);
    for (const path of ['/site-api/wishlist', '/site-api/wishlist/ids']) {
      const res = await guest.get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(res.headers.getSetCookie().some(c => c.startsWith('visitor_id='))).toBe(false);
    }
    expect((await guest.get('/site-api/wishlist')).json).toEqual({items: [], ids: []});
    expect(await db.visitor.findMany()).toEqual([]);
    const del = await guest.delete('/site-api/wishlist/alpha');
    expect(del.json).toEqual({ids: []});
    expect(await db.visitor.findMany()).toEqual([]);
  });

  it('a guest adds pieces (idempotent) under a new visitor cookie', async () => {
    const guest = new Browser(app);
    const first = await guest.post('/site-api/wishlist', {productId: 'alpha'});
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ids: ['alpha']});
    expect(first.headers.get('cache-control')).toContain('no-store');
    const visitorId = guest.jar.get('visitor_id');
    expect(visitorId).toMatch(/^[a-f0-9]{48}$/);
    expect(await db.visitor.count()).toBe(1);

    expect((await guest.post('/site-api/wishlist', {productId: 'alpha'})).json).toEqual({ids: ['alpha']});
    expect((await guest.post('/site-api/wishlist', {productId: 'gamma'})).json).toEqual({ids: ['alpha', 'gamma']});
    expect(await db.wishlistItem.count({where: {visitorId}})).toBe(2);
  });

  it('refuses unknown, draft and malformed products', async () => {
    const guest = new Browser(app);
    const unknown = await guest.post('/site-api/wishlist', {productId: 'nope'});
    expect(unknown.status).toBe(404);
    expect(unknown.json.error).toBe('not_found');
    expect((await guest.post('/site-api/wishlist', {productId: 'draft-one'})).status).toBe(404);
    const empty = await guest.post('/site-api/wishlist', {});
    expect(empty.status).toBe(422);
    expect((empty.json.fields as Record<string, string>).productId).toBe('Choose a product');
    expect((await guest.post('/site-api/wishlist', {productId: 'x'.repeat(121)})).status).toBe(422);
  });

  it('writes need the CSRF token', async () => {
    const guest = new Browser(app);
    await guest.get('/site-api/auth/csrf');
    const res = await guest.request('POST', '/site-api/wishlist', {productId: 'alpha'}, {'x-csrf-token': 'wrong'});
    expect(res.status).toBe(403);
    expect(await db.wishlistItem.count()).toBe(0);
  });

  it('lists published pieces oldest first; an archived piece drops out', async () => {
    const guest = new Browser(app);
    await guest.post('/site-api/wishlist', {productId: 'gamma'});
    await guest.post('/site-api/wishlist', {productId: 'alpha'});
    await guest.post('/site-api/wishlist', {productId: 'beta'});
    const list = await guest.get('/site-api/wishlist');
    expect(list.status).toBe(200);
    expect(list.json.ids).toEqual(['gamma', 'alpha', 'beta']);
    const items = list.json.items as Array<{id: string; name: string; stock: string; price: number}>;
    expect(items.map(p => p.id)).toEqual(['gamma', 'alpha', 'beta']);
    expect(items[0]).toMatchObject({name: 'Piece gamma', price: 120});
    expect(items[2]!.stock).toBe('out');

    await db.product.update({where: {id: 'alpha'}, data: {status: 'archived'}});
    expect((await guest.get('/site-api/wishlist')).json.ids).toEqual(['gamma', 'beta']);
    expect((await guest.get('/site-api/wishlist/ids')).json).toEqual({ids: ['gamma', 'beta']});
  });

  it('removes idempotently, and only from the visitor’s own list', async () => {
    const one = new Browser(app, '203.0.113.21');
    const two = new Browser(app, '203.0.113.22');
    await one.post('/site-api/wishlist', {productId: 'alpha'});
    await one.post('/site-api/wishlist', {productId: 'gamma'});
    await two.post('/site-api/wishlist', {productId: 'alpha'});

    expect((await two.delete('/site-api/wishlist/gamma')).json).toEqual({ids: ['alpha']});
    expect((await one.get('/site-api/wishlist/ids')).json).toEqual({ids: ['alpha', 'gamma']});
    expect((await one.delete('/site-api/wishlist/alpha')).json).toEqual({ids: ['gamma']});
    expect((await one.delete('/site-api/wishlist/alpha')).json).toEqual({ids: ['gamma']});
    expect((await two.get('/site-api/wishlist/ids')).json).toEqual({ids: ['alpha']});
  });

  it('caps a wishlist at 100 pieces', async () => {
    const guest = new Browser(app);
    await guest.post('/site-api/wishlist', {productId: 'alpha'});
    const visitorId = guest.jar.get('visitor_id')!;
    const ids = Array.from({length: 100}, (_, i) => `bulk-${String(i).padStart(3, '0')}`);
    await db.product.createMany({
      data: ids.map(id => ({
        id,
        name: id,
        brand: 'VAREL',
        priceCents: 1000,
        sku: `SKU-${id}`,
        short: 's',
        description: 'd',
        material: 'm',
        departmentId: deptId,
        categoryId: catId,
      })),
    });
    await db.wishlistItem.createMany({data: ids.slice(0, 99).map(productId => ({visitorId, productId}))});
    const full = await guest.post('/site-api/wishlist', {productId: ids[99]});
    expect(full.status).toBe(409);
    expect(full.json.error).toBe('wishlist_full');
    const again = await guest.post('/site-api/wishlist', {productId: 'alpha'});
    expect(again.status).toBe(200);
    expect((again.json.ids as string[]).length).toBe(100);
  });

  it('a signed-in shopper’s list is keyed by account, apart from the guest list of the browser', async () => {
    const user = await signedIn(app, 'shopper@example.test');
    const added = await user.post('/site-api/wishlist', {productId: 'gamma'});
    expect(added.json).toEqual({ids: ['gamma']});
    const row = await db.wishlistItem.findFirstOrThrow({where: {productId: 'gamma'}});
    expect(row.userId).not.toBeNull();
    expect(row.visitorId).toBeNull();
    expect((await user.get('/site-api/wishlist')).json.ids).toEqual(['gamma']);
    expect((await new Browser(app).get('/site-api/wishlist/ids')).json).toEqual({ids: []});
  });

  it('moves in-stock pieces to the bag and keeps the rest', async () => {
    const guest = new Browser(app);
    await guest.post('/site-api/wishlist', {productId: 'alpha'});
    await guest.post('/site-api/wishlist', {productId: 'beta'});
    await guest.post('/site-api/wishlist', {productId: 'gamma'});

    const moved = await guest.post('/site-api/wishlist/move-to-bag', {});
    expect(moved.status).toBe(200);
    expect(moved.json.ids).toEqual(['beta']);
    const cart = moved.json.cart as {lines: Array<{productId: string; qty: number; sku: string}>; totals: {count: number}};
    expect(cart.lines.map(l => [l.productId, l.qty])).toEqual([
      ['alpha', 1],
      ['gamma', 1],
    ]);
    expect(cart.totals.count).toBe(2);

    // Saved again: gamma merges into its line (2 of 2 in stock); a third time it stays.
    await guest.post('/site-api/wishlist', {productId: 'gamma'});
    const second = await guest.post('/site-api/wishlist/move-to-bag', {productIds: ['gamma']});
    expect(second.json.ids).toEqual(['beta']);
    expect((second.json.cart as typeof cart).lines.find(l => l.productId === 'gamma')!.qty).toBe(2);
    await guest.post('/site-api/wishlist', {productId: 'gamma'});
    const third = await guest.post('/site-api/wishlist/move-to-bag', {productIds: ['gamma']});
    expect(third.json.ids).toEqual(['beta', 'gamma']);
    expect((third.json.cart as typeof cart).totals.count).toBe(3);

    const none = await guest.post('/site-api/wishlist/move-to-bag', {productIds: []});
    expect(none.status).toBe(200);
    expect(none.json.ids).toEqual(['beta', 'gamma']);
    expect((await guest.post('/site-api/wishlist/move-to-bag', {productIds: 'gamma'})).status).toBe(422);
  });
});
