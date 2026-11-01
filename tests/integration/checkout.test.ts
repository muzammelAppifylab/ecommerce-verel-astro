import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {app} from '../../src/server/app';
import {expirePending} from '../../src/server/jobs/pending-payments';
import {refundOrder, restockOrder, sendTemplate} from '../../src/server/lib/contracts';
import {signStripePayload} from '../../src/server/lib/payments/stripe';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';
import {env} from './support/cloudflare-workers';

/** WP-11: checkout, Stripe settle/cancel, the Stripe webhook, the expiry job, shipping reads and the refund contracts. */

vi.mock('../../src/server/lib/contracts', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/server/lib/contracts')>();
  return {...real, sendTemplate: vi.fn(async () => undefined)};
});
const sent = vi.mocked(sendTemplate);
const sentKeys = () => sent.mock.calls.map(c => c[1]);

// ─── Stripe stub (api.stripe.com only; everything else goes to the harness fetch) ───
type StripeCall = {method: string; url: string; body: string; headers: Headers};
let stripeCalls: StripeCall[] = [];
let stripeAnswer: (call: StripeCall) => {status: number; json: unknown} = () => ({status: 500, json: {error: {message: 'no stub'}}});
const harnessFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.stripe.com/')) {
    const call = {method: init?.method ?? 'GET', url, body: String(init?.body ?? ''), headers: new Headers(init?.headers)};
    stripeCalls.push(call);
    const a = stripeAnswer(call);
    return new Response(JSON.stringify(a.json), {status: a.status, headers: {'content-type': 'application/json'}});
  }
  return harnessFetch(input, init);
};

const CARD = {name: 'Test Buyer', number: '4242 4242 4242 4242', expiry: '12/39', cvc: '123'};
const DK = {name: 'Ada Lovelace', line1: 'Nørregade 12', city: 'Copenhagen', zip: '2100', country: 'Denmark'};

async function fixtures() {
  const dep = await db.department.create({data: {name: 'Women', slug: 'women'}});
  const cat = await db.category.create({data: {name: 'Coats', slug: 'coats', departmentId: dep.id}});
  const base = {brand: 'VAREL', short: 's', description: 'd', material: 'wool', departmentId: dep.id, categoryId: cat.id};
  await db.product.create({data: {...base, id: 'coat', name: 'Wool Coat', priceCents: 10000, sku: 'COAT'}});
  await db.variant.create({data: {id: 'coat-m', productId: 'coat', size: 'M', priceCents: 10000, inventory: 5}});
  await db.product.create({data: {...base, id: 'tee', name: 'Last Tee', priceCents: 3000, sku: 'TEE'}});
  await db.variant.create({data: {id: 'tee-s', productId: 'tee', size: 'S', priceCents: 3000, inventory: 1}});
  await db.product.create({
    data: {...base, id: 'guide', name: 'Care Guide', type: 'digital', priceCents: 2000, sku: 'GUIDE', download: 'files/guide.pdf'},
  });
  await db.variant.create({data: {id: 'guide-1', productId: 'guide', priceCents: 2000, inventory: null}});
  await db.shippingZone.create({data: {id: 'dk', name: 'Denmark', countries: ['Denmark'], position: 0}});
  await db.shippingMethod.create({data: {id: 'dk-std', zoneId: 'dk', name: 'Standard', detail: '2–3 days', rateCents: 500}});
  await db.shippingZone.create({data: {id: 'world', name: 'Rest of world', countries: [], position: 1}});
  await db.shippingMethod.create({data: {id: 'world-std', zoneId: 'world', name: 'Standard', detail: '5–8 days', rateCents: 2500}});
  // No tax, no free-shipping threshold: totals are easy to read.
  await db.setting.update({where: {id: 1}, data: {taxRate: 0, freeShippingThresholdCents: 1_000_000, lowStockThreshold: 3}});
}

/** A guest browser whose bag holds `lines` (the visitor cookie comes from a first, empty checkout). */
async function shopper(lines: [string, string, number][], browser = new Browser(app)) {
  const first = await browser.post('/site-api/checkout', {email: 'guest@example.test'});
  expect(first.status).toBe(422);
  expect(first.json.error).toBe('cart_empty');
  const visitorId = browser.jar.get('visitor_id');
  expect(visitorId).toBeTruthy();
  const cart = await db.cart.upsert({where: {visitorId}, create: {visitorId}, update: {}});
  await db.cartLine.createMany({data: lines.map(([productId, variantId, qty]) => ({cartId: cart.id, productId, variantId, qty}))});
  return {browser, cartId: cart.id};
}

const body = (extra: Record<string, unknown> = {}) => ({
  email: 'guest@example.test',
  shippingAddress: DK,
  shippingMethodId: 'dk-std',
  payment: CARD,
  ...extra,
});

async function enableStripe() {
  env.STRIPE_SECRET_KEY = 'sk_test_integration';
  env.STRIPE_WEBHOOK_SECRET = 'whsec_integration';
  await db.setting.update({where: {id: 1}, data: {paymentProvider: 'stripe', stripePublishableKey: 'pk_test_integration'}});
}

const intent = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  object: 'payment_intent',
  status,
  client_secret: `${id}_secret_x`,
  metadata: {},
  ...extra,
});

async function webhook(event: unknown, secret = 'whsec_integration') {
  const payload = JSON.stringify(event);
  const sig = await signStripePayload(payload, secret);
  const res = await app.request('https://shop.example.test/site-api/webhooks/stripe', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'stripe-signature': sig, origin: 'https://evil.example'},
    body: payload,
  });
  return {status: res.status, json: (await res.json()) as Record<string, unknown>};
}

describe.skipIf(!DATABASE_URL)('checkout (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    await fixtures();
    sent.mockClear();
    stripeCalls = [];
    delete env.STRIPE_SECRET_KEY;
    delete env.STRIPE_WEBHOOK_SECRET;
  });
  afterEach(() => {
    delete env.STRIPE_SECRET_KEY;
    delete env.STRIPE_WEBHOOK_SECRET;
  });

  it('places a simulated guest order: Paid, stock taken, bag emptied, confirmation sent', async () => {
    const {browser, cartId} = await shopper([
      ['coat', 'coat-m', 2],
      ['tee', 'tee-s', 1],
    ]);
    const res = await browser.post('/site-api/checkout', body({expectedTotal: 235}));
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const order = res.json.order as {number: string; payment: string; total: number};
    expect(order.payment).toBe('Paid');
    expect(order.total).toBe(235);
    expect(res.json.payment).toEqual({provider: 'simulated'});

    const row = await db.shopOrder.findUniqueOrThrow({
      where: {number: order.number},
      include: {items: true, events: true, payments: true},
    });
    expect(row).toMatchObject({fulfillment: 'Unfulfilled', stage: 1, cardBrand: 'Visa', cardLast4: '4242', totalCents: 23500});
    expect(row.method).toBe('Standard · 2–3 days');
    expect(row.items.map(i => [i.sku, i.qty, i.category])).toEqual([
      ['coat-m', 2, 'Coats'],
      ['tee-s', 1, 'Coats'],
    ]);
    expect(row.events[0]!.message).toBe('Order placed as a guest · 3 items');
    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({provider: 'simulated', status: 'succeeded', amountCents: 23500, cardLast4: '4242'});
    expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(3);
    expect((await db.variant.findUniqueOrThrow({where: {id: 'tee-s'}})).inventory).toBe(0);
    expect(await db.cartLine.findFirst({where: {cartId}})).toBeNull();
    // The coat crossed the low-stock threshold (5 → 3 with threshold 3): one alert, then the confirmation.
    expect(sentKeys()).toEqual(['low_stock_alert', 'order_confirmation']);
    const alert = sent.mock.calls[0]![3] as {items: {sku: string; stock: number}[]};
    expect(alert.items).toEqual([expect.objectContaining({sku: 'coat-m', stock: 3})]);
    const vars = sent.mock.calls[1]![3] as Record<string, unknown>;
    expect(vars).toMatchObject({orderNumber: order.number, firstName: 'Ada', shipping: '$5', total: '$235', paymentMethod: 'Visa ending 4242'});

    // The tee is gone: a second order for it is out of stock.
    const again = await shopper([['tee', 'tee-s', 1]]);
    const out = await again.browser.post('/site-api/checkout', body());
    expect(out.status).toBe(409);
    expect(out.json.error).toBe('out_of_stock');
  });

  it('validates the address, method, billing and card with field keys', async () => {
    const {browser} = await shopper([['coat', 'coat-m', 1]]);
    const noAddress = await browser.post('/site-api/checkout', body({shippingAddress: null}));
    expect(noAddress.status).toBe(422);
    expect(noAddress.json.fields).toEqual({shippingAddress: 'Enter a shipping address'});

    const badZip = await browser.post('/site-api/checkout', body({shippingAddress: {...DK, zip: '12'}}));
    expect(badZip.status).toBe(422);
    expect(Object.keys(badZip.json.fields as object)).toContain('shippingAddress.zip');

    const unknownCountry = await browser.post('/site-api/checkout', body({shippingAddress: {...DK, country: 'Atlantis'}}));
    expect((unknownCountry.json.fields as Record<string, string>)['shippingAddress.country']).toBe('Choose a country we ship to');

    const method = await browser.post('/site-api/checkout', body({shippingMethodId: 'world-std'}));
    expect(method.json.fields).toEqual({shippingMethodId: 'Choose a shipping method for Denmark'});

    const billing = await browser.post('/site-api/checkout', body({billingSameAsShipping: false}));
    expect(billing.json.fields).toEqual({billingAddress: 'Enter a billing address'});

    const noCard = await browser.post('/site-api/checkout', body({payment: null}));
    expect(noCard.json.fields).toEqual({payment: 'Enter your card details'});

    const badCard = await browser.post('/site-api/checkout', body({payment: {...CARD, number: '4242 4242 4242 4241'}}));
    expect(badCard.status).toBe(422);
    expect(Object.keys(badCard.json.fields as object)).toContain('payment.number');

    const declined = await browser.post('/site-api/checkout', body({payment: {...CARD, number: '4000 0000 0000 0002'}}));
    expect(declined.status).toBe(402);
    expect(declined.json.error).toBe('payment_declined');

    const changed = await browser.post('/site-api/checkout', body({expectedTotal: 104.99}));
    expect(changed.status).toBe(409);
    expect(changed.json.error).toBe('total_changed');
    expect(changed.json.message).toBe('Your total is now $105. Check your order summary and place the order again');

    expect(await db.shopOrder.findFirst({select: {id: true}})).toBeNull();
    expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(5);
  });

  it('applies checkout rules: guest checkout off, phone, terms', async () => {
    const {browser} = await shopper([['coat', 'coat-m', 1]]);
    await db.setting.update({where: {id: 1}, data: {guestCheckout: false}});
    const guest = await browser.post('/site-api/checkout', body());
    expect(guest.status).toBe(401);
    expect(guest.json.error).toBe('sign_in_required');
    await db.setting.update({where: {id: 1}, data: {guestCheckout: true, requirePhone: true, termsText: 'Be nice'}});
    const rules = await browser.post('/site-api/checkout', body());
    expect(rules.status).toBe(422);
    expect(Object.keys(rules.json.fields as object).sort()).toEqual(['acceptTerms', 'phone']);
    const ok = await browser.post('/site-api/checkout', body({phone: '+45 12 34 56 78', acceptTerms: true}));
    expect(ok.status).toBe(201);
  });

  it('a digital-only free order is delivered at once and has no payment row', async () => {
    await db.discount.create({data: {code: 'FREEGUIDE', kind: 'percent', percentOff: 100, label: 'Free guide'}});
    const {browser, cartId} = await shopper([['guide', 'guide-1', 1]]);
    await db.cart.update({where: {id: cartId}, data: {discountCode: 'FREEGUIDE'}});
    const res = await browser.post('/site-api/checkout', {email: 'guest@example.test'});
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const row = await db.shopOrder.findUniqueOrThrow({
      where: {number: (res.json.order as {number: string}).number},
      include: {events: {orderBy: {at: 'asc'}}, payments: true, items: true, redemptions: true},
    });
    expect(row).toMatchObject({fulfillment: 'Delivered', stage: 4, method: 'Digital delivery', totalCents: 0, discountCode: 'FREEGUIDE'});
    expect(row.address).toBeNull();
    expect(row.payments).toHaveLength(0);
    expect(row.items[0]).toMatchObject({digital: true, download: 'files/guide.pdf'});
    expect(row.events.map(e => e.kind)).toEqual(['placed', 'status']);
    expect(row.redemptions).toHaveLength(1);
    expect(row.redemptions[0]).toMatchObject({code: 'FREEGUIDE', amountCents: 2000});
    expect((await db.cart.findUniqueOrThrow({where: {id: cartId}})).discountCode).toBeNull();
  });

  it('a unique code is used once', async () => {
    const d = await db.discount.create({data: {name: 'Welcome', codeType: 'unique', kind: 'percent', percentOff: 10, label: 'Welcome 10%'}});
    await db.discountCode.create({data: {discountId: d.id, code: 'WELCOME-ABC'}});
    const a = await shopper([['coat', 'coat-m', 1]]);
    await db.cart.update({where: {id: a.cartId}, data: {discountCode: 'WELCOME-ABC'}});
    const first = await a.browser.post('/site-api/checkout', body());
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const code = await db.discountCode.findUniqueOrThrow({where: {code: 'WELCOME-ABC'}});
    expect(code.usedAt).not.toBeNull();
    expect(code.orderId).not.toBeNull();

    const b = await shopper([['coat', 'coat-m', 1]]);
    await db.cart.update({where: {id: b.cartId}, data: {discountCode: 'WELCOME-ABC'}});
    const second = await b.browser.post('/site-api/checkout', body());
    expect(second.status).toBe(422);
    expect(String(second.json.error)).toMatch(/^discount_/);
  });

  it('a signed-in order saves the address once and opts the profile in', async () => {
    const browser = await signedIn(app, 'ada@example.test');
    const uid = await userId('ada@example.test');
    const cart = await db.cart.create({data: {userId: uid}});
    const fill = () => db.cartLine.create({data: {cartId: cart.id, productId: 'coat', variantId: 'coat-m', qty: 1}});
    await fill();
    const order = {...body({email: 'ada@example.test', saveAddress: true, newsletter: true})};
    const res = await browser.post('/site-api/checkout', order);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    await fill();
    expect((await browser.post('/site-api/checkout', order)).status).toBe(201);
    const addresses = await db.address.findMany({where: {userId: uid}});
    expect(addresses).toHaveLength(1);
    expect(addresses[0]!.primary).toBe(true);
    expect(await db.newsletterSubscriber.findUnique({where: {email: 'ada@example.test'}})).toMatchObject({source: 'checkout'});
    expect(await db.customerProfile.findUnique({where: {userId: uid}})).toMatchObject({marketingOptIn: true});
    const placed = await db.shopOrder.findFirstOrThrow({where: {userId: uid}, include: {events: true}});
    expect(placed.events[0]!.message).toBe('Order placed · 1 item');
  });

  describe('Stripe', () => {
    beforeEach(enableStripe);

    it('config reports stripe only when fully configured', async () => {
      const res = await new Browser(app).get('/site-api/checkout/config');
      expect(res.json).toEqual({provider: 'stripe', publishableKey: 'pk_test_integration', currency: 'USD'});
      delete env.STRIPE_SECRET_KEY;
      const off = await new Browser(app).get('/site-api/checkout/config');
      expect(off.json).toEqual({provider: 'simulated', publishableKey: null, currency: 'USD'});
    });

    it('creates a Pending order with a PaymentIntent; sync settles it once', async () => {
      stripeAnswer = c => (c.method === 'POST' ? {status: 200, json: intent('pi_1', 'requires_payment_method')} : {status: 200, json: intent('pi_1', 'succeeded', {payment_method: {type: 'card', card: {brand: 'visa', last4: '4242'}}})});
      const {browser} = await shopper([['coat', 'coat-m', 1]]);
      const res = await browser.post('/site-api/checkout', body({payment: undefined}));
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect(res.json.payment).toEqual({provider: 'stripe', clientSecret: 'pi_1_secret_x', publishableKey: 'pk_test_integration'});
      const number = (res.json.order as {number: string}).number;
      const create = stripeCalls[0]!;
      expect(create.url).toBe('https://api.stripe.com/v1/payment_intents');
      expect(create.headers.get('authorization')).toBe('Bearer sk_test_integration');
      expect(create.headers.get('idempotency-key')).toMatch(/^order-\d+$/);
      expect(new URLSearchParams(create.body).get('amount')).toBe('10500');
      expect(new URLSearchParams(create.body).get('metadata[orderNumber]')).toBe(number);
      const row = await db.shopOrder.findUniqueOrThrow({where: {number}, include: {payments: true}});
      expect(row.payment).toBe('Pending');
      expect(row.payments[0]).toMatchObject({status: 'requires_payment', providerRef: 'pi_1'});
      expect(sentKeys()).not.toContain('order_confirmation');

      // Not the owner's email: 404.
      const stranger = await new Browser(app).post(`/site-api/checkout/${number}/sync`, {email: 'x@example.test'});
      expect(stranger.status).toBe(404);
      const synced = await new Browser(app).post(`/site-api/checkout/${number}/sync`, {email: 'GUEST@example.test'});
      expect(synced.status).toBe(200);
      expect((synced.json.order as {payment: string}).payment).toBe('Paid');
      expect((await db.shopOrder.findUniqueOrThrow({where: {number}})).cardLast4).toBe('4242');
      await browser.post(`/site-api/checkout/${number}/sync`, {email: 'guest@example.test'});
      expect(sentKeys().filter(k => k === 'order_confirmation')).toHaveLength(1);
    });

    it('a Stripe failure on create fails the order and restores the bag', async () => {
      stripeAnswer = () => ({status: 500, json: {error: {message: 'boom'}}});
      const {browser, cartId} = await shopper([['coat', 'coat-m', 2]]);
      const res = await browser.post('/site-api/checkout', body({payment: undefined}));
      expect(res.status).toBe(502);
      expect(res.json.error).toBe('payment_provider_error');
      const row = await db.shopOrder.findFirstOrThrow({include: {payments: true}});
      expect(row.payment).toBe('Failed');
      expect(row.payments[0]!.status).toBe('failed');
      expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(5);
      expect(await db.cartLine.findMany({where: {cartId}, select: {variantId: true, qty: true}})).toEqual([{variantId: 'coat-m', qty: 2}]);
    });

    it('cancel releases a Pending order and restores the bag once', async () => {
      stripeAnswer = c =>
        c.url.endsWith('/cancel') ? {status: 200, json: intent('pi_2', 'canceled')} : {status: 200, json: intent('pi_2', 'requires_payment_method')};
      const {browser, cartId} = await shopper([['coat', 'coat-m', 1]]);
      const res = await browser.post('/site-api/checkout', body({payment: undefined}));
      const number = (res.json.order as {number: string}).number;
      expect(await db.cartLine.findFirst({where: {cartId}})).toBeNull();
      const cancel = await browser.post(`/site-api/checkout/${number}/cancel`, {email: 'guest@example.test'});
      expect(cancel.status).toBe(200);
      expect(cancel.json.restored).toBe(true);
      expect((cancel.json.order as {payment: string}).payment).toBe('Failed');
      expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(5);
      const again = await browser.post(`/site-api/checkout/${number}/cancel`, {email: 'guest@example.test'});
      expect(again.json.restored).toBe(false);
      expect(await db.cartLine.count({where: {cartId}})).toBe(1);
    });

    it('cancel of an intent still processing answers 409 and changes nothing', async () => {
      stripeAnswer = c =>
        c.url.endsWith('/cancel') ? {status: 400, json: {error: {message: 'processing'}}} : {status: 200, json: intent('pi_3', 'processing')};
      const {browser} = await shopper([['coat', 'coat-m', 1]]);
      stripeAnswer = c =>
        c.method === 'POST' && !c.url.endsWith('/cancel')
          ? {status: 200, json: intent('pi_3', 'requires_payment_method')}
          : c.url.endsWith('/cancel')
            ? {status: 400, json: {error: {message: 'processing'}}}
            : {status: 200, json: intent('pi_3', 'processing')};
      const res = await browser.post('/site-api/checkout', body({payment: undefined}));
      const number = (res.json.order as {number: string}).number;
      const cancel = await browser.post(`/site-api/checkout/${number}/cancel`, {email: 'guest@example.test'});
      expect(cancel.status).toBe(409);
      expect(cancel.json.error).toBe('payment_processing');
      expect((await db.shopOrder.findUniqueOrThrow({where: {number}})).payment).toBe('Pending');
    });

    it('webhook: signature, succeeded once, ref backfill, refunds SET, late success after failure', async () => {
      stripeAnswer = c => (c.url.endsWith('/cancel') ? {status: 200, json: intent('pi_4', 'canceled')} : {status: 200, json: intent('pi_4', 'requires_payment_method')});
      const {browser} = await shopper([['coat', 'coat-m', 1]]);
      const res = await browser.post('/site-api/checkout', body({payment: undefined}));
      const number = (res.json.order as {number: string}).number;
      const order = await db.shopOrder.findUniqueOrThrow({where: {number}});
      // Simulate the ref-write race: the payment row has no ref yet.
      await db.shopPayment.updateMany({where: {orderId: order.id}, data: {providerRef: null}});

      const bad = await webhook({id: 'evt_0', type: 'payment_intent.succeeded', data: {object: intent('pi_4', 'succeeded')}}, 'whsec_wrong');
      expect(bad.status).toBe(400);
      expect(bad.json.error).toBe('bad_signature');

      const paidEvent = {
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: {object: intent('pi_4', 'succeeded', {metadata: {orderNumber: number}, payment_method: {type: 'card', card: {brand: 'mastercard', last4: '4444'}}})},
      };
      expect((await webhook(paidEvent)).json).toEqual({received: true});
      expect(await webhook(paidEvent)).toMatchObject({status: 200});
      const paid = await db.shopOrder.findUniqueOrThrow({where: {id: order.id}, include: {payments: true}});
      expect(paid.payment).toBe('Paid');
      expect(paid.cardBrand).toBe('Mastercard');
      expect(paid.payments[0]).toMatchObject({providerRef: 'pi_4', status: 'succeeded'});
      expect(sentKeys().filter(k => k === 'order_confirmation')).toHaveLength(1);

      const refund = (amount: number, full: boolean) =>
        webhook({id: `evt_r${amount}`, type: 'charge.refunded', data: {object: {id: 'ch_1', payment_intent: 'pi_4', amount_refunded: amount, currency: 'usd', refunded: full}}});
      await refund(3000, false);
      await refund(3000, false);
      expect(await db.shopPayment.findFirstOrThrow({where: {orderId: order.id}})).toMatchObject({refundedCents: 3000, status: 'partially_refunded'});
      await refund(10500, true);
      expect(await db.shopPayment.findFirstOrThrow({where: {orderId: order.id}})).toMatchObject({refundedCents: 10500, status: 'refunded'});

      // Unknown intent: acknowledged, nothing changes.
      expect((await webhook({id: 'evt_x', type: 'payment_intent.succeeded', data: {object: intent('pi_unknown', 'succeeded')}})).status).toBe(200);

      // Failed then paid late: stock is taken again.
      const second = await shopper([['coat', 'coat-m', 1]]);
      stripeAnswer = c => (c.url.endsWith('/cancel') ? {status: 200, json: intent('pi_5', 'canceled')} : {status: 200, json: intent('pi_5', 'requires_payment_method')});
      const res2 = await second.browser.post('/site-api/checkout', body({payment: undefined}));
      const o2 = await db.shopOrder.findUniqueOrThrow({where: {number: (res2.json.order as {number: string}).number}});
      expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(3);
      const failed = await webhook({
        id: 'evt_f',
        type: 'payment_intent.payment_failed',
        data: {object: intent('pi_5', 'requires_payment_method', {last_payment_error: {message: 'Your card was declined.'}})},
      });
      expect(failed.status).toBe(200);
      expect(stripeCalls.some(c => c.url.endsWith('/v1/payment_intents/pi_5/cancel'))).toBe(true);
      expect((await db.shopOrder.findUniqueOrThrow({where: {id: o2.id}})).payment).toBe('Failed');
      expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(4);
      await webhook({id: 'evt_late', type: 'payment_intent.succeeded', data: {object: intent('pi_5', 'succeeded', {payment_method: {type: 'card', card: {brand: 'visa', last4: '1111'}}})}});
      const late = await db.shopOrder.findUniqueOrThrow({where: {id: o2.id}, include: {events: {orderBy: {at: 'asc'}}}});
      expect(late.payment).toBe('Paid');
      expect(late.events.at(-1)!.message).toContain('Payment received after the order was cancelled');
      expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(3);
    });

    it('webhook without a secret answers 503', async () => {
      delete env.STRIPE_WEBHOOK_SECRET;
      expect((await webhook({id: 'e', type: 'x', data: {object: {}}})).status).toBe(503);
    });

    it('the expiry job fails old Pending orders, settles paid ones, leaves young ones', async () => {
      stripeAnswer = c => (c.url.endsWith('/cancel') ? {status: 200, json: intent('pi_6', 'canceled')} : {status: 200, json: intent('pi_6', 'requires_payment_method')});
      const a = await shopper([['coat', 'coat-m', 1]]);
      const resA = await a.browser.post('/site-api/checkout', body({payment: undefined}));
      const numberA = (resA.json.order as {number: string}).number;
      stripeAnswer = c => (c.url.endsWith('/cancel') ? {status: 200, json: intent('pi_7', 'succeeded')} : {status: 200, json: intent('pi_7', 'requires_payment_method')});
      const b = await shopper([['coat', 'coat-m', 1]]);
      const resB = await b.browser.post('/site-api/checkout', body({payment: undefined}));
      const numberB = (resB.json.order as {number: string}).number;
      stripeAnswer = () => ({status: 200, json: intent('pi_9', 'requires_payment_method')});
      const c = await shopper([['coat', 'coat-m', 1]]);
      const resC = await c.browser.post('/site-api/checkout', body({payment: undefined}));
      const numberC = (resC.json.order as {number: string}).number;

      const old = new Date(Date.now() - 61 * 60_000);
      await db.shopOrder.updateMany({where: {number: {in: [numberA, numberB]}}, data: {placedAt: old}});
      stripeAnswer = call =>
        call.url.includes('pi_6') ? {status: 200, json: intent('pi_6', 'canceled')} : {status: 200, json: intent('pi_7', 'succeeded')};
      const result = await expirePending(db, new Date());
      expect(result).toEqual({expired: 1, paid: 1});
      const byNumber = async (n: string) => (await db.shopOrder.findUniqueOrThrow({where: {number: n}, include: {events: true}}));
      const expired = await byNumber(numberA);
      expect(expired.payment).toBe('Failed');
      expect(expired.events.some(e => e.message.startsWith('Payment expired after 60 minutes'))).toBe(true);
      expect((await byNumber(numberB)).payment).toBe('Paid');
      expect((await byNumber(numberC)).payment).toBe('Pending');
    });

    it('refundOrder: Stripe refund with an idempotency key, error records nothing', async () => {
      stripeAnswer = c =>
        c.url.endsWith('/v1/refunds')
          ? {status: 200, json: {id: 're_1', object: 'refund', amount: 4000, status: 'succeeded'}}
          : {status: 200, json: intent('pi_8', 'requires_payment_method')};
      const {browser} = await shopper([['coat', 'coat-m', 1]]);
      const res = await browser.post('/site-api/checkout', body({payment: undefined}));
      const order = await db.shopOrder.findUniqueOrThrow({where: {number: (res.json.order as {number: string}).number}});
      await webhook({id: 'evt_p', type: 'payment_intent.succeeded', data: {object: intent('pi_8', 'succeeded', {payment_method: {type: 'card', card: {brand: 'visa', last4: '4242'}}})}});
      const given = await refundOrder(db, order, 4000, 'order');
      expect(given).toBe(4000);
      const call = stripeCalls.find(c => c.url.endsWith('/v1/refunds'))!;
      expect(call.headers.get('idempotency-key')).toBe(`refund-${order.id}-order`);
      expect(await db.shopPayment.findFirstOrThrow({where: {orderId: order.id}})).toMatchObject({refundedCents: 4000, status: 'partially_refunded'});
      stripeAnswer = () => ({status: 400, json: {error: {message: 'Nope'}}});
      await expect(refundOrder(db, order, 1000, 'return-1')).rejects.toMatchObject({status: 502});
      expect((await db.shopPayment.findFirstOrThrow({where: {orderId: order.id}})).refundedCents).toBe(4000);
    });
  });

  it('refundOrder (simulated) caps at what is left; restockOrder skips digital lines', async () => {
    const {browser} = await shopper([
      ['coat', 'coat-m', 2],
      ['guide', 'guide-1', 1],
    ]);
    const res = await browser.post('/site-api/checkout', body());
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const order = await db.shopOrder.findUniqueOrThrow({where: {number: (res.json.order as {number: string}).number}});
    expect(await refundOrder(db, order, 10000, 'order')).toBe(10000);
    expect(await refundOrder(db, order, 50000, 'cancel')).toBe(order.totalCents - 10000);
    expect(await refundOrder(db, order, 100, 'again')).toBe(0);
    expect(await db.shopPayment.findFirstOrThrow({where: {orderId: order.id}})).toMatchObject({status: 'refunded', refundedCents: order.totalCents});
    expect(await restockOrder(db, order.id)).toBe(2);
    expect((await db.variant.findUniqueOrThrow({where: {id: 'coat-m'}})).inventory).toBe(5);
  });

  it('shipping and countries reads', async () => {
    const browser = new Browser(app);
    const zones = await browser.get('/site-api/shipping/zones');
    expect(zones.status).toBe(200);
    expect(zones.headers.get('cache-control')).toBe('private, max-age=300');
    expect(zones.json.freeThreshold).toBe(10000);
    expect((zones.json.zones as {zone: string}[]).map(z => z.zone)).toEqual(['Denmark', 'Rest of world']);
    const methods = await browser.get('/site-api/shipping/methods?country=Japan');
    expect(methods.json).toMatchObject({zone: 'Rest of world', methods: [{id: 'world-std', name: 'Standard', rate: 25}]});
    const dk = await browser.get('/site-api/shipping/methods');
    expect(dk.json.zone).toBe('Denmark');
    const countries = await browser.get('/site-api/countries');
    expect(countries.headers.get('cache-control')).toContain('public');
    expect(countries.json).toBeTypeOf('object');
  });

  it('POST /checkout needs the CSRF token (mounted after csrf)', async () => {
    const browser = new Browser(app);
    const res = await browser.request('POST', '/site-api/checkout', body(), {'x-csrf-token': ''});
    expect(res.status).toBe(403);
  });
});
