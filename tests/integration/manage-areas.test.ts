import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** The store admin's central area guard (`/site-api/manage/*`) and the public slots, against Postgres. */
describe.skipIf(!DATABASE_URL)('store admin areas (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.11');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.12');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.13');
    const id = await userId('staff@example.test');
    const made = await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']});
    expect(made.status).toBe(200);
  });

  it('guests are asked to sign in, customers are refused', async () => {
    expect((await new Browser(app).get('/site-api/manage/orders')).status).toBe(401);
    expect((await customer.get('/site-api/manage/orders')).status).toBe(403);
    expect((await customer.get('/site-api/manage/dashboard')).status).toBe(403);
  });

  it('staff reach their areas but not store settings writes', async () => {
    // Past the guard: orders (WP-19), products (WP-17) and settings (WP-23) are filled.
    expect((await staff.get('/site-api/manage/orders')).status).toBe(200);
    expect((await staff.get('/site-api/manage/products')).status).toBe(200);
    expect((await staff.get('/site-api/manage/settings')).status).toBe(200);
    expect((await staff.request('PATCH', '/site-api/manage/settings', {})).status).toBe(403);
    expect((await owner.request('PATCH', '/site-api/manage/settings', {})).status).toBe(200);
  });

  it('/me gives staff the store abilities, not settings', async () => {
    const me = await staff.get('/site-api/me');
    const abilities = me.json.abilities as Record<string, boolean>;
    expect(abilities.manageOrders).toBe(true);
    expect(abilities.manageProducts).toBe(true);
    expect(abilities.manageStoreSettings).toBe(false);
    const mine = (await customer.get('/site-api/me')).json.abilities as Record<string, boolean>;
    expect(Object.values(mine).some(Boolean)).toBe(false);
  });

  it('public slots answer the error shape', async () => {
    const res = await new Browser(app).get('/site-api/cart');
    expect(res.status).toBe(501);
    expect(res.json).toMatchObject({error: 'not_implemented'});
    expect((await new Browser(app).get('/site-api/products/sitemap')).json).toEqual({items: []});
    expect((await new Browser(app).get('/site-api/nope')).status).toBe(404);
  });
});
