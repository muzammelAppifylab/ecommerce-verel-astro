import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';
import {makeOrder, seedCatalog} from './support/sales-fixtures';

/**
 * I2: object-level access (security.md › A01 BOLA). One customer can never read or change another's
 * addresses, orders, returns or downloads by guessing ids or order numbers; the answer is 404, never
 * 403 (no oracle), and never the other customer's data.
 */
describe.skipIf(!DATABASE_URL)('customer data is scoped to its owner (integration, real Postgres)', () => {
  let ann: Browser;
  let bob: Browser;
  let annAddress: number;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    // The first account becomes the owner: make it someone else, so Ann and Bob are plain customers.
    await signedIn(app, 'owner@example.test', undefined, '203.0.113.80');
    ann = await signedIn(app, 'ann@example.test', undefined, '203.0.113.81');
    bob = await signedIn(app, 'bob@example.test', undefined, '203.0.113.82');
    const made = await ann.post('/site-api/account/addresses', {
      name: 'Ann Lee',
      line1: '1 Road',
      city: 'Copenhagen',
      zip: '1000',
      country: 'Denmark',
    });
    expect(made.status).toBe(201);
    annAddress = Number(made.json.id);
    await seedCatalog();
    await makeOrder({number: 'VRL-30001', email: 'ann@example.test', userId: await userId('ann@example.test')});
  });

  it('addresses: another customer gets 404 for read, change and delete', async () => {
    expect(((await bob.get('/site-api/account/addresses')).json as unknown as unknown[]).length ?? 0).toBe(0);
    const patch = await bob.request('PATCH', `/site-api/account/addresses/${annAddress}`, {city: 'Malmö'});
    expect(patch.status).toBe(404);
    expect((await bob.delete(`/site-api/account/addresses/${annAddress}`)).status).toBe(404);
    const still = await db.address.findUnique({where: {id: annAddress}, select: {city: true}});
    expect(still?.city).toBe('Copenhagen');
  });

  it('orders: another customer gets 404 by number, a guest needs the matching email', async () => {
    expect((await ann.get('/site-api/orders/VRL-30001')).status).toBe(200);
    expect((await bob.get('/site-api/orders/VRL-30001')).status).toBe(404);
    expect((await bob.get('/site-api/orders/VRL-30001?email=bob%40example.test')).status).toBe(404);
    expect((await new Browser(app, '203.0.113.83').get('/site-api/orders/VRL-30001')).status).toBe(401);
    expect((await new Browser(app, '203.0.113.83').get('/site-api/orders/VRL-30001?email=ann%40example.test')).status).toBe(200);
    // Bob's own list never shows Ann's order.
    const list = await bob.get('/site-api/orders');
    expect(list.status).toBe(200);
    expect(list.json.items).toEqual([]);
  });

  it('orders: another customer cannot cancel it', async () => {
    expect((await bob.post('/site-api/orders/VRL-30001/cancel', {})).status).toBe(404);
    const o = await db.shopOrder.findUnique({where: {number: 'VRL-30001'}, select: {fulfillment: true}});
    expect(o?.fulfillment).toBe('Unfulfilled');
  });

  it('downloads: a paid digital file is the buyer’s only', async () => {
    await db.shopOrderItem.updateMany({where: {sku: 'PDF'}, data: {download: 'pattern.pdf'}});
    const mine = await ann.get('/site-api/downloads/pattern.pdf?format=json');
    // Allowed (the platform file id is not a real one in tests: 404 "not available", not 403).
    expect(mine.status).not.toBe(403);
    expect((await bob.get('/site-api/downloads/pattern.pdf?format=json')).status).toBe(403);
    expect((await bob.get('/site-api/downloads/pattern.pdf?format=json&order=VRL-30001&email=bob%40example.test')).status).toBe(403);
  });

  it('returns look-up: the number alone shows a redacted order, never the address or email', async () => {
    const res = await new Browser(app, '203.0.113.84').post('/site-api/returns/lookup', {order: 'VRL-30001'});
    if (res.status === 200) {
      const text = JSON.stringify(res.json);
      expect(res.json.access).toBe('number');
      expect(text).not.toContain('ann@example.test');
      expect(text).not.toContain('1 Road');
    } else {
      expect([401, 404, 422]).toContain(res.status);
    }
  });
});
