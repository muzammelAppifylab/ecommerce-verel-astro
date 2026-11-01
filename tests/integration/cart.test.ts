import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {recoveryToken} from '../../src/server/lib/abandoned';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn} from './support/harness';

/** The bag (WP-09): /site-api/cart/*, against a real Postgres with a small catalogue. */

const SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';

type Line = {lineId: string; productId: string; sku: string; qty: number; total: number; discount: number};
type CartJson = {
  id: string;
  lines: Line[];
  discountCode: string | null;
  discountError: {code: string; message: string} | null;
  totals: {subtotal: number; shipping: number; count: number; freeThreshold: number; discounts: {code: string | null}[]};
};

async function seedCatalogue() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}});
  const cat = await db.category.create({data: {name: 'Shirts', slug: 'shirts', departmentId: dept.id}});
  const base = {brand: 'VAREL', short: 's', description: 'd', material: 'm', departmentId: dept.id, categoryId: cat.id};
  await db.product.create({
    data: {
      ...base,
      id: 'tee',
      name: 'Forma Tee',
      sku: 'TEE',
      priceCents: 5000,
      variants: {
        create: [
          {id: 'tee-stone-m', color: 'Stone', size: 'M', priceCents: 5000, inventory: 5, position: 0},
          {id: 'tee-stone-l', color: 'Stone', size: 'L', priceCents: 5000, inventory: 0, position: 1},
          {id: 'tee-ink-l', color: 'Ink', size: 'L', priceCents: 5000, inventory: 3, position: 2},
        ],
      },
    },
  });
  await db.product.create({
    data: {...base, id: 'draft', name: 'Draft', sku: 'DRAFT', status: 'draft', priceCents: 1000, variants: {create: [{id: 'draft-v', priceCents: 1000, inventory: 10}]}},
  });
  await db.product.create({
    data: {...base, id: 'bo', name: 'Made To Order', sku: 'BO', allowBackorder: true, priceCents: 2000, variants: {create: [{id: 'bo-v', priceCents: 2000, inventory: 0}]}},
  });
  await db.product.create({
    data: {...base, id: 'ebook', name: 'Ebook', sku: 'EBOOK', type: 'digital', priceCents: 1500, variants: {create: [{id: 'ebook-v', priceCents: 1500, inventory: null}]}},
  });
  await db.shippingZone.create({
    data: {id: 'eu', name: 'Europe', countries: ['Denmark'], methods: {create: [{id: 'eu-standard', name: 'Standard', rateCents: 900}, {id: 'eu-express', name: 'Express', rateCents: 2500, position: 1}]}},
  });
  await db.discount.create({data: {code: 'STUDIO10', kind: 'percent', percentOff: 10, label: 'Studio 10%'}});
  await db.discount.create({data: {code: 'BIG', kind: 'percent', percentOff: 20, label: 'Big spender', minimumCents: 100_000}});
}

const add = (b: Browser, body: Record<string, unknown>) => b.post('/site-api/cart/items', body);
const cartOf = (r: {json: Record<string, unknown>}) => r.json as unknown as CartJson;

describe.skipIf(!DATABASE_URL)('cart (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalogue();
  }, 60_000);

  it('GET /cart for a new guest is an empty bag and writes nothing', async () => {
    const guest = new Browser(app);
    const res = await guest.get('/site-api/cart');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.getSetCookie().some(c => c.startsWith('visitor_id='))).toBe(false);
    const cart = cartOf(res);
    expect(cart.id).toBe('');
    expect(cart.lines).toEqual([]);
    expect(cart.totals.freeThreshold).toBe(150);
    expect(await db.visitor.findFirst()).toBeNull();
    expect(await db.cart.findFirst()).toBeNull();
  });

  it('adds lines for a guest (cookie set), merges the same variant, picks colour + size', async () => {
    const guest = new Browser(app);
    const first = await add(guest, {productId: 'tee', variantId: 'tee-stone-m', qty: 1});
    expect(first.status).toBe(200);
    expect(guest.jar.get('visitor_id')).toBeTruthy();
    const again = await add(guest, {productId: 'tee', color: 'Stone', size: 'M', qty: 2});
    const cart = cartOf(again);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.qty).toBe(3);
    expect(cart.totals.count).toBe(3);

    const ink = await add(guest, {productId: 'tee', color: 'Ink', size: 'L'});
    expect(cartOf(ink).lines.map(l => l.sku)).toEqual(['tee-stone-m', 'tee-ink-l']);
  });

  it('refuses unknown products, bad combinations, sold out pieces and bad input', async () => {
    const guest = new Browser(app);
    expect((await add(guest, {productId: 'nope'})).status).toBe(404);
    expect((await add(guest, {productId: 'draft'})).status).toBe(404);
    const combo = await add(guest, {productId: 'tee', color: 'Ink', size: 'M'});
    expect(combo.status).toBe(422);
    expect(combo.json.error).toBe('variant_unavailable');
    const sold = await add(guest, {productId: 'tee', variantId: 'tee-stone-l'});
    expect(sold.status).toBe(409);
    expect(sold.json.error).toBe('out_of_stock');
    const many = await add(guest, {productId: 'tee', variantId: 'tee-stone-m', qty: 6});
    expect(many.status).toBe(409);
    expect(String(many.json.message)).toMatch(/5/);
    for (const qty of [0, 100, 1.5, 'x']) expect((await add(guest, {productId: 'tee', qty})).status).toBe(422);
    expect((await add(guest, {productId: 'x'.repeat(121)})).status).toBe(422);
    // Backorder and digital pieces pass.
    expect((await add(guest, {productId: 'bo', qty: 4})).status).toBe(200);
    expect((await add(guest, {productId: 'ebook'})).status).toBe(200);
  });

  it('changes and removes lines of its own bag only', async () => {
    const guest = new Browser(app);
    const other = new Browser(app, '203.0.113.20');
    const lineId = cartOf(await add(guest, {productId: 'tee', variantId: 'tee-stone-m'})).lines[0]!.lineId;
    await add(other, {productId: 'tee', variantId: 'tee-ink-l'});

    const up = await guest.request('PATCH', `/site-api/cart/items/${lineId}`, {qty: 4});
    expect(up.status).toBe(200);
    expect(cartOf(up).lines[0]!.qty).toBe(4);
    expect((await guest.request('PATCH', `/site-api/cart/items/${lineId}`, {qty: 6})).status).toBe(409);
    expect((await other.request('PATCH', `/site-api/cart/items/${lineId}`, {qty: 2})).status).toBe(404);
    expect((await guest.request('PATCH', '/site-api/cart/items/abc', {qty: 2})).status).toBe(404);
    expect((await guest.request('PATCH', '/site-api/cart/items/99999999999', {qty: 2})).status).toBe(404);

    expect((await guest.delete(`/site-api/cart/items/${lineId}`)).status).toBe(200);
    expect((await guest.delete(`/site-api/cart/items/${lineId}`)).status).toBe(404);

    const again = cartOf(await add(guest, {productId: 'tee', variantId: 'tee-stone-m'})).lines[0]!.lineId;
    const zero = await guest.request('PATCH', `/site-api/cart/items/${again}`, {qty: 0});
    expect(cartOf(zero).lines).toEqual([]);
  });

  it('applies, keeps and removes discount codes', async () => {
    const guest = new Browser(app);
    await add(guest, {productId: 'tee', variantId: 'tee-stone-m', qty: 2});
    const ok = await guest.post('/site-api/cart/discount', {code: ' studio10 '});
    expect(ok.status).toBe(200);
    expect(cartOf(ok).discountCode).toBe('STUDIO10');
    expect(cartOf(ok).totals.discounts.map(d => d.code)).toContain('STUDIO10');

    const bad = await guest.post('/site-api/cart/discount', {code: 'NOPE'});
    expect(bad.status).toBe(422);
    expect(bad.json.error).toBe('discount_invalid');
    expect(cartOf(await guest.get('/site-api/cart')).discountCode).toBe('STUDIO10');
    expect((await guest.post('/site-api/cart/discount', {code: 'X'.repeat(41)})).status).toBe(422);

    const min = await guest.post('/site-api/cart/discount', {code: 'BIG'});
    expect(min.status).toBe(200);
    expect(cartOf(min).discountCode).toBe('BIG');
    expect(cartOf(min).discountError?.code).toBe('DISCOUNT_MINIMUM');

    const cleared = await guest.delete('/site-api/cart/discount');
    expect(cartOf(cleared).discountCode).toBeNull();
  });

  it('prices totals at the chosen shipping method, Denmark first method by default', async () => {
    const guest = new Browser(app);
    await add(guest, {productId: 'tee', variantId: 'tee-stone-m'});
    const express = await guest.get('/site-api/cart/totals?country=Denmark&method=eu-express');
    expect(express.status).toBe(200);
    expect(express.json.shipping).toBe(25);
    expect(typeof express.json.lineDiscounts).toBe('object');
    const plain = await guest.get('/site-api/cart/totals');
    expect(plain.json.shipping).toBe(9);
  });

  it('stores the bag email lower-cased with the locale', async () => {
    const guest = new Browser(app);
    await add(guest, {productId: 'tee', variantId: 'tee-stone-m'});
    const res = await guest.post('/site-api/cart/email', {email: 'Shopper@Example.com'});
    expect(res.status).toBe(200);
    const row = await db.cart.findFirstOrThrow({select: {email: true, locale: true}});
    expect(row.email).toBe('shopper@example.com');
    expect(row.locale).toBe('en');
    expect((await guest.post('/site-api/cart/email', {email: 'nope'})).status).toBe(422);
  });

  it('hides lines of unpublished products but still lets them be removed', async () => {
    const guest = new Browser(app);
    const lineId = cartOf(await add(guest, {productId: 'tee', variantId: 'tee-stone-m'})).lines[0]!.lineId;
    await db.product.update({where: {id: 'tee'}, data: {status: 'draft'}});
    expect(cartOf(await guest.get('/site-api/cart')).lines).toEqual([]);
    expect((await guest.delete(`/site-api/cart/items/${lineId}`)).status).toBe(200);
  });

  it('refuses writes without the CSRF header', async () => {
    const guest = new Browser(app);
    await guest.get('/site-api/auth/csrf');
    const res = await guest.request('POST', '/site-api/cart/items', {productId: 'tee'}, {'x-csrf-token': ''});
    expect(res.status).toBe(403);
  });

  it('folds a guest bag into the account on the first signed-in read', async () => {
    const user = await signedIn(app, 'shopper@example.test');
    const guest = new Browser(app);
    await add(guest, {productId: 'tee', variantId: 'tee-ink-l', qty: 2});
    user.jar.set('visitor_id', guest.jar.get('visitor_id')!);
    const res = await user.get('/site-api/cart');
    expect(cartOf(res).lines.map(l => [l.sku, l.qty])).toEqual([['tee-ink-l', 2]]);
    expect(await db.cart.count({where: {visitorId: {not: null}}})).toBe(0);
  });

  it('recovers an abandoned guest bag into another browser (larger quantity wins)', async () => {
    const a = new Browser(app);
    const b = new Browser(app, '203.0.113.21');
    const aCart = cartOf(await add(a, {productId: 'tee', variantId: 'tee-stone-m', qty: 2}));
    await add(b, {productId: 'tee', variantId: 'tee-stone-m', qty: 3});
    await add(b, {productId: 'tee', variantId: 'tee-ink-l', qty: 1});
    const token = await recoveryToken(SECRET, Number(aCart.id));

    const res = await b.get(`/site-api/cart/recover/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/cart/');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const now = cartOf(await b.get('/site-api/cart'));
    expect(now.id).toBe(aCart.id);
    expect(now.lines.map(l => [l.sku, l.qty])).toEqual([
      ['tee-stone-m', 3],
      ['tee-ink-l', 1],
    ]);
    expect(await db.cart.count()).toBe(1);

    const bad = await b.get('/site-api/cart/recover/not-a-token');
    expect(bad.status).toBe(302);
    expect(await db.cart.count()).toBe(1);
  });

  it('recovers a bag into a signed-in account by copying its pieces', async () => {
    const guest = new Browser(app);
    const gCart = cartOf(await add(guest, {productId: 'tee', variantId: 'tee-stone-m', qty: 2}));
    const user = await signedIn(app, 'buyer@example.test');
    const res = await user.get(`/site-api/cart/recover/${await recoveryToken(SECRET, Number(gCart.id))}`);
    expect(res.status).toBe(302);
    const mine = cartOf(await user.get('/site-api/cart'));
    expect(mine.id).not.toBe(gCart.id);
    expect(mine.lines.map(l => [l.sku, l.qty])).toEqual([['tee-stone-m', 2]]);
  });
});
