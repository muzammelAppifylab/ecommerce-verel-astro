import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * `POST /site-api/account/onboarding` (WP-15): after a sign-in on the `/account/*` pages, the customer
 * profile, the sign-up extras, the guest bag + wishlist merge and the welcome email (once).
 */
const sendTemplate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../src/server/lib/contracts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/server/lib/contracts')>()),
  sendTemplate,
}));

const VISITOR = 'a'.repeat(48);

async function seedProduct() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}, select: {id: true}});
  const cat = await db.category.create({data: {name: 'Shirts', slug: 'shirts', departmentId: dept.id}, select: {id: true}});
  await db.product.create({
    data: {
      id: 'linen-shirt',
      name: 'Linen shirt',
      brand: 'VAREL',
      priceCents: 12000,
      sku: 'LS-1',
      short: 'A shirt',
      description: 'A linen shirt',
      material: 'Linen',
      departmentId: dept.id,
      categoryId: cat.id,
    },
  });
}

describe.skipIf(!DATABASE_URL)('account onboarding (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  beforeEach(async () => {
    await resetDatabase();
    sendTemplate.mockClear();
  });
  afterAll(() => db.$disconnect());

  it('guests get 401', async () => {
    expect((await new Browser(app).post('/site-api/account/onboarding', {})).status).toBe(401);
  });

  it('creates the profile from the account name, welcomes once', async () => {
    const browser = await signedIn(app, 'mira@example.test');
    await db.user.update({where: {email: 'mira@example.test'}, data: {name: 'Mira Holm'}});
    // The access token still carries the old name: sign in again.
    await browser.post('/site-api/auth/login', {email: 'mira@example.test', password: 'a long test passphrase'});

    const first = await browser.post('/site-api/account/onboarding', {});
    expect(first.status).toBe(200);
    expect(first.json).toEqual({profileCreated: true, subscribed: false, merged: false});
    expect(first.headers.get('cache-control') ?? '').toMatch(/no-store/);
    const profile = await db.customerProfile.findUniqueOrThrow({where: {userId: await userId('mira@example.test')}});
    expect(profile).toMatchObject({firstName: 'Mira', lastName: 'Holm', locale: 'en', marketingOptIn: false});
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(sendTemplate.mock.calls[0]).toMatchObject([
      expect.anything(),
      'welcome',
      'mira@example.test',
      {firstName: 'Mira', accountUrl: expect.stringMatching(/\/account\/$/)},
      {related: {type: 'user', id: String(profile.userId)}, locale: 'en'},
    ]);

    const second = await browser.post('/site-api/account/onboarding', {});
    expect(second.json).toEqual({profileCreated: false, subscribed: false, merged: false});
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('old accounts get a profile but no welcome', async () => {
    const browser = await signedIn(app, 'old@example.test');
    await db.user.update({where: {email: 'old@example.test'}, data: {createdAt: new Date(Date.now() - 90 * 86_400_000)}});
    expect((await browser.post('/site-api/account/onboarding', {})).json.profileCreated).toBe(true);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('applies the sign-up extras for the same email only', async () => {
    const other = await signedIn(app, 'other@example.test');
    const ignored = await other.post('/site-api/account/onboarding', {
      email: 'mira@example.test',
      firstName: 'Mira',
      lastName: 'Holm',
      newsletter: true,
    });
    expect(ignored.json).toMatchObject({profileCreated: true, subscribed: false});
    expect(await db.newsletterSubscriber.count()).toBe(0);
    expect((await db.customerProfile.findUniqueOrThrow({where: {userId: await userId('other@example.test')}})).firstName).toBe('other');

    const mira = await signedIn(app, 'mira@example.test');
    const applied = await mira.post('/site-api/account/onboarding', {
      email: 'MIRA@example.test',
      firstName: ' Mira ',
      lastName: 'Holm',
      newsletter: true,
    });
    expect(applied.json).toMatchObject({profileCreated: true, subscribed: true});
    const profile = await db.customerProfile.findUniqueOrThrow({where: {userId: await userId('mira@example.test')}});
    expect(profile).toMatchObject({firstName: 'Mira', lastName: 'Holm', marketingOptIn: true});
    expect(await db.newsletterSubscriber.findUniqueOrThrow({where: {email: 'mira@example.test'}})).toMatchObject({source: 'signup'});

    // Names are never overwritten later; newsletter false never unsubscribes.
    const later = await mira.post('/site-api/account/onboarding', {email: 'mira@example.test', firstName: 'X', newsletter: false});
    expect(later.json).toMatchObject({profileCreated: false, subscribed: false});
    expect((await db.customerProfile.findUniqueOrThrow({where: {userId: profile.userId}})).firstName).toBe('Mira');
    expect(await db.newsletterSubscriber.count()).toBe(1);
  });

  it('merges the guest bag and wishlist into the account', async () => {
    await seedProduct();
    await db.visitor.create({data: {id: VISITOR}});
    await db.wishlistItem.create({data: {visitorId: VISITOR, productId: 'linen-shirt'}});
    await db.cart.create({data: {visitorId: VISITOR, discountCode: 'WELCOME10'}});

    const browser = await signedIn(app, 'mira@example.test');
    browser.jar.set('visitor_id', VISITOR);
    const res = await browser.post('/site-api/account/onboarding', {});
    expect(res.json).toMatchObject({merged: true});
    const id = await userId('mira@example.test');
    expect(await db.wishlistItem.findMany({where: {userId: id}, select: {productId: true}})).toEqual([{productId: 'linen-shirt'}]);
    expect(await db.wishlistItem.count({where: {visitorId: VISITOR}})).toBe(0);
    expect(await db.cart.findUnique({where: {visitorId: VISITOR}})).toBeNull();
    expect((await db.cart.findUniqueOrThrow({where: {userId: id}})).discountCode).toBe('WELCOME10');
  });

  it('refuses names that are too long', async () => {
    const browser = await signedIn(app, 'mira@example.test');
    const res = await browser.post('/site-api/account/onboarding', {email: 'mira@example.test', firstName: 'a'.repeat(81)});
    expect(res.status).toBe(422);
    expect(res.json.fields).toHaveProperty('firstName');
  });

  it('two tabs at once make one profile and one welcome', async () => {
    const browser = await signedIn(app, 'mira@example.test');
    const [a, b] = await Promise.all([
      browser.post('/site-api/account/onboarding', {}),
      browser.post('/site-api/account/onboarding', {}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.json.profileCreated, b.json.profileCreated].filter(Boolean)).toHaveLength(1);
    expect(await db.customerProfile.count()).toBe(1);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });
});
