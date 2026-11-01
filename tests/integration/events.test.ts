import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {trackEvent} from '../../src/server/lib/contracts';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

const visitorOf = (b: Browser) => b.jar.get('visitor_id') ?? b.jar.get('__Host-visitor_id');

async function seedProduct() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}});
  const cat = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: dept.id}});
  await db.product.create({
    data: {id: 'p-real', name: 'Real', brand: 'V', priceCents: 1000, sku: 'SKU-REAL', short: 's', description: 'd', material: 'm', departmentId: dept.id, categoryId: cat.id},
  });
}

/** POST /site-api/events (the storefront beacon), against Postgres. */
describe.skipIf(!DATABASE_URL)('analytics events (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    await seedProduct();
  });

  it('stores a valid batch for the visitor and sets the visitor cookie', async () => {
    const b = new Browser(app);
    const res = await b.request('POST', '/site-api/events', {
      events: [
        {type: 'page_view', path: '/shop/'},
        {type: 'product_view', productId: 'p-real'},
        {type: 'product_view', productId: 'p-gone'},
        {type: 'search', query: '  Linen DRESS ', results: 0},
        {type: 'add_to_cart', productId: 'p-real', query: 'ignored', results: 5},
      ],
    });
    expect(res.status).toBe(204);
    const visitor = visitorOf(b);
    expect(visitor).toMatch(/^[a-f0-9]{48}$/);
    const rows = await db.analyticsEvent.findMany({orderBy: {id: 'asc'}});
    expect(rows).toHaveLength(5);
    expect(rows.every(r => r.sessionId === visitor && r.userId === null)).toBe(true);
    expect(rows[0]).toMatchObject({type: 'page_view', path: '/shop/', productId: null});
    expect(rows[1]!.productId).toBe('p-real');
    expect(rows[2]!.productId).toBeNull();
    expect(rows[3]).toMatchObject({type: 'search', query: 'linen dress', results: 0});
    expect(rows[4]).toMatchObject({type: 'add_to_cart', query: null, results: null});
  });

  it('records the signed-in user', async () => {
    const b = await signedIn(app, 'shopper@example.test');
    expect((await b.request('POST', '/site-api/events', {events: [{type: 'checkout_start'}]})).status).toBe(204);
    const row = await db.analyticsEvent.findFirstOrThrow();
    expect(row.userId).toBe(await userId('shopper@example.test'));
  });

  it('refuses invalid batches', async () => {
    const b = new Browser(app);
    const many = Array.from({length: 21}, () => ({type: 'page_view'}));
    for (const body of [
      {events: []},
      {events: many},
      {events: [{type: 'nope'}]},
      {events: [{type: 'purchase'}]},
      {events: [{type: 'page_view', path: '/' + 'a'.repeat(300)}]},
    ]) {
      const res = await b.request('POST', '/site-api/events', body);
      expect(res.status).toBe(422);
      expect(res.json).toMatchObject({error: 'invalid_input'});
    }
    expect(await db.analyticsEvent.count()).toBe(0);
  });

  it('stores nothing when analytics is off in the store settings', async () => {
    await db.setting.update({where: {id: 1}, data: {analyticsEnabled: false}});
    const res = await new Browser(app).request('POST', '/site-api/events', {events: [{type: 'page_view'}]});
    expect(res.status).toBe(204);
    expect(await db.analyticsEvent.count()).toBe(0);
  });

  it('needs the CSRF header and the same origin', async () => {
    const b = new Browser(app);
    const noCsrf = await b.request('POST', '/site-api/events', {events: [{type: 'page_view'}]}, {'x-csrf-token': ''});
    expect(noCsrf.status).toBe(403);
    const cross = await b.request('POST', '/site-api/events', {events: [{type: 'page_view'}]}, {origin: 'https://evil.example', 'sec-fetch-site': 'cross-site'});
    expect(cross.status).toBe(403);
    expect(await db.analyticsEvent.count()).toBe(0);
  });

  it('trackEvent records server events and ignores purchases', async () => {
    await trackEvent(db, {type: 'search', query: 'Wool', results: 2, visitorId: 'abc'});
    await trackEvent(db, {type: 'purchase'});
    const rows = await db.analyticsEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({type: 'search', query: 'wool', results: 2, sessionId: 'abc'});
  });
});
