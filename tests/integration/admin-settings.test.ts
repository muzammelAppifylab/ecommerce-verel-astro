import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {env} from './support/cloudflare-workers';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** WP-23: `/site-api/manage/settings` and `/site-api/manage/payments/status`, against Postgres. */
describe.skipIf(!DATABASE_URL)('store settings admin (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;
  const envAny = env as unknown as Record<string, string | undefined>;

  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
  }, 120_000);
  afterAll(() => db.$disconnect());
  // Signing up is slow (PBKDF2): the accounts are made once, the settings row is reset per test.
  beforeEach(async () => {
    await db.$executeRawUnsafe('DELETE FROM "settings"');
    await db.$executeRawUnsafe('INSERT INTO "settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP)');
  });
  afterEach(() => {
    delete envAny.STRIPE_SECRET_KEY;
    delete envAny.STRIPE_WEBHOOK_SECRET;
  });

  describe('settings', () => {
    it('owner reads the full shape; secrets are flags, all false without owner secrets', async () => {
      const res = await owner.get('/site-api/manage/settings');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(res.json).toMatchObject({storeName: expect.any(String), currency: expect.any(String), locales: expect.any(Array)});
      expect(Object.values(res.json.secrets as Record<string, boolean>).every(v => v === false)).toBe(true);
    });

    it('staff without the settings permission read but cannot write; customers and guests are refused', async () => {
      expect((await staff.get('/site-api/manage/settings')).status).toBe(200);
      expect((await staff.request('PATCH', '/site-api/manage/settings', {storeName: 'X'})).status).toBe(403);
      expect((await customer.get('/site-api/manage/settings')).status).toBe(403);
      expect((await new Browser(app).get('/site-api/manage/settings')).status).toBe(401);
    });

    it('PATCH changes only what was sent', async () => {
      const before = (await owner.get('/site-api/manage/settings')).json;
      const res = await owner.request('PATCH', '/site-api/manage/settings', {storeName: 'Studio'});
      expect(res.status).toBe(200);
      expect(res.json.storeName).toBe('Studio');
      expect({...res.json, storeName: before.storeName}).toEqual(before);
    });

    it('free shipping threshold is stored in cents and read back in units', async () => {
      const res = await owner.request('PATCH', '/site-api/manage/settings', {freeShippingThreshold: 99.99});
      expect(res.json.freeShippingThreshold).toBe(99.99);
      const row = await db.setting.findUniqueOrThrow({where: {id: 1}, select: {freeShippingThresholdCents: true}});
      expect(row.freeShippingThresholdCents).toBe(9999);
    });

    it('locales keep the default enabled and first', async () => {
      const bad = await owner.request('PATCH', '/site-api/manage/settings', {locales: ['da']});
      expect(bad.status).toBe(422);
      expect(bad.json.fields).toHaveProperty('locales');
      const good = await owner.request('PATCH', '/site-api/manage/settings', {defaultLocale: 'da', locales: ['en', 'da']});
      expect(good.status).toBe(200);
      expect(good.json.locales).toEqual(['da', 'en']);
    });

    it('Stripe needs a publishable key', async () => {
      const res = await owner.request('PATCH', '/site-api/manage/settings', {paymentProvider: 'stripe'});
      expect(res.status).toBe(422);
      expect(res.json.fields).toHaveProperty('stripePublishableKey');
    });

    it('field errors use dotted keys', async () => {
      const res = await owner.request('PATCH', '/site-api/manage/settings', {socialLinks: {instagram: '/path'}, orderPrefix: 'VRL1'});
      expect(res.status).toBe(422);
      expect(Object.keys(res.json.fields as Record<string, string>)).toEqual(expect.arrayContaining(['socialLinks.instagram', 'orderPrefix']));
    });

    it('{} changes nothing; homeHero {} clears a stored hero', async () => {
      const before = (await owner.get('/site-api/manage/settings')).json;
      const same = await owner.request('PATCH', '/site-api/manage/settings', {});
      expect(same.status).toBe(200);
      expect(same.json).toEqual(before);
      const hero = {title: 'Hello', primaryCta: {label: 'Shop', url: '/shop/'}};
      expect((await owner.request('PATCH', '/site-api/manage/settings', {homeHero: hero})).json.homeHero).toMatchObject(hero);
      const cleared = await owner.request('PATCH', '/site-api/manage/settings', {homeHero: {}});
      expect(cleared.json.homeHero ?? {}).toEqual({});
    });

    it('re-running the seed after a PATCH keeps the change', async () => {
      await owner.request('PATCH', '/site-api/manage/settings', {storeName: 'Kept'});
      await db.$executeRawUnsafe(`INSERT INTO "settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`);
      expect((await owner.get('/site-api/manage/settings')).json.storeName).toBe('Kept');
    });
  });

  describe('payments status', () => {
    it('simulated by default, webhook URL on the site, no key values', async () => {
      const res = await owner.get('/site-api/manage/payments/status');
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        active: 'simulated',
        selected: 'simulated',
        secretKey: {set: false, mode: null},
        apiHostOverride: false,
      });
      expect(res.json.webhookUrl).toMatch(/\/site-api\/webhooks\/stripe$/);
    });

    it('Stripe is active with a secret key, a publishable key and the provider chosen', async () => {
      envAny.STRIPE_SECRET_KEY = 'sk_test_supersecretvalue';
      const saved = await owner.request('PATCH', '/site-api/manage/settings', {paymentProvider: 'stripe', stripePublishableKey: 'pk_test_abc'});
      expect(saved.status).toBe(200);
      expect((saved.json.secrets as Record<string, boolean>).stripeSecretKey).toBe(true);
      const res = await owner.get('/site-api/manage/payments/status');
      expect(res.json).toMatchObject({
        active: 'stripe',
        selected: 'stripe',
        secretKey: {set: true, mode: 'test'},
        publishableKey: {set: true, mode: 'test'},
      });
      expect(JSON.stringify(res.json)).not.toContain('supersecretvalue');
      expect(JSON.stringify(saved.json)).not.toContain('supersecretvalue');
    });

    it('staff without the settings permission are refused', async () => {
      expect((await staff.get('/site-api/manage/payments/status')).status).toBe(403);
    });
  });
});
