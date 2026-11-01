import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {keyMode, paymentConfig, stripeReady, STRIPE_WEBHOOK_EVENTS, STRIPE_WEBHOOK_PATH} from '../src/server/lib/payments/index';
import {
  centsFromStripe,
  formEncode,
  intentInfo,
  providerError,
  signStripePayload,
  STRIPE_API_VERSION,
  stripeProvider,
  stripeRequest,
  toStripeAmount,
  verifyStripeSignature,
} from '../src/server/lib/payments/stripe';
import {env} from './integration/support/cloudflare-workers';

/** WP-11: the Stripe client on fetch, webhook signatures, provider config (no network, no database). */

const SECRET = 'sk_test_unit_0123456789';

describe('Stripe amounts', () => {
  it('converts cents to the minor unit and back', () => {
    expect(toStripeAmount(14850, 'USD')).toBe(14850);
    expect(toStripeAmount(1500000, 'JPY')).toBe(15000);
    expect(toStripeAmount(1234, 'KWD')).toBe(12340);
    expect(centsFromStripe(14850, 'usd')).toBe(14850);
    expect(centsFromStripe(15000, 'jpy')).toBe(1500000);
    expect(centsFromStripe(12340, 'kwd')).toBe(1234);
    for (const [c, cur] of [[999, 'EUR'], [120000, 'KRW'], [5, 'BHD']] as const) expect(centsFromStripe(toStripeAmount(c, cur), cur)).toBe(c);
  });
});

describe('webhook signatures', () => {
  const body = '{"id":"evt_1","type":"payment_intent.succeeded","data":{"object":{}}}';
  const whsec = 'whsec_unit';
  const now = 1_800_000_000;

  it('accepts a good signature and refuses everything else', async () => {
    const header = await signStripePayload(body, whsec, now);
    expect(await verifyStripeSignature(body, header, whsec, 300, now * 1000)).toBe(true);
    expect(await verifyStripeSignature(body, header, 'whsec_other', 300, now * 1000)).toBe(false);
    expect(await verifyStripeSignature(body + ' ', header, whsec, 300, now * 1000)).toBe(false);
    expect(await verifyStripeSignature(body, header, whsec, 300, (now + 301) * 1000)).toBe(false);
    expect(await verifyStripeSignature(body, header, whsec, 300, (now - 301) * 1000)).toBe(false);
    const v1 = header.split('v1=')[1]!;
    expect(await verifyStripeSignature(body, `t=${now},v1=${'0'.repeat(64)},v1=${v1}`, whsec, 300, now * 1000)).toBe(true);
    expect(await verifyStripeSignature(body, `v1=${v1}`, whsec, 300, now * 1000)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${now},v1=zz${v1.slice(2)}`, whsec, 300, now * 1000)).toBe(false);
    expect(await verifyStripeSignature(body, '', whsec)).toBe(false);
  });
});

describe('Stripe REST client', () => {
  const calls: {url: string; init: RequestInit}[] = [];
  let answers: (() => Response | Promise<Response>)[] = [];

  beforeEach(() => {
    env.STRIPE_SECRET_KEY = SECRET;
    calls.length = 0;
    answers = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({url: String(input), init});
      const next = answers.shift();
      if (!next) throw new Error('unexpected Stripe call');
      return next();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete env.STRIPE_SECRET_KEY;
  });

  const ok = (body: unknown) => () => new Response(JSON.stringify(body), {status: 200});
  const fail = (status: number, message: string) => () => new Response(JSON.stringify({error: {message, code: 'x'}}), {status});

  it('form-encodes nested keys and arrays', () => {
    const s = decodeURIComponent(formEncode({a: 1, metadata: {orderNumber: 'VRL-1'}, expand: ['payment_method'], skip: undefined}));
    expect(s).toBe('a=1&metadata[orderNumber]=VRL-1&expand[]=payment_method');
  });

  it('creates an intent with the right request', async () => {
    answers.push(ok({id: 'pi_1', status: 'requires_payment_method', client_secret: 'pi_1_secret'}));
    const r = await stripeProvider().createIntent({amountCents: 14850, currency: 'USD', orderId: 7, orderNumber: 'VRL-24817', email: 'a@example.com', storeName: 'VAREL'});
    expect(r).toEqual({ref: 'pi_1', clientSecret: 'pi_1_secret'});
    const {url, init} = calls[0]!;
    expect(url).toBe('https://api.stripe.com/v1/payment_intents');
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe(`Bearer ${SECRET}`);
    expect(h.get('idempotency-key')).toBe('order-7');
    expect(h.get('stripe-version')).toBe(STRIPE_API_VERSION);
    const body = new URLSearchParams(String(init.body));
    expect(body.get('amount')).toBe('14850');
    expect(body.get('currency')).toBe('usd');
    expect(body.get('automatic_payment_methods[enabled]')).toBe('true');
    expect(body.get('metadata[orderNumber]')).toBe('VRL-24817');
    expect(body.get('metadata[orderId]')).toBe('7');
    expect(body.get('description')).toBe('VAREL order VRL-24817');
  });

  it('retrieves with expand[] and retries a 5xx once on a GET', async () => {
    answers.push(fail(500, 'boom'), ok({id: 'pi_2', status: 'succeeded', payment_method: {id: 'pm', type: 'card', card: {brand: 'visa', last4: '4242'}}}));
    const info = await stripeProvider().getIntent('pi_2');
    expect(info).toEqual({ref: 'pi_2', status: 'succeeded', brand: 'Visa', last4: '4242', failureMessage: null});
    expect(calls).toHaveLength(2);
    expect(decodeURIComponent(calls[0]!.url)).toBe('https://api.stripe.com/v1/payment_intents/pi_2?expand[]=payment_method');
  });

  it('never repeats a POST without an idempotency key', async () => {
    answers.push(fail(503, 'down'));
    await expect(stripeRequest('POST', '/v1/payment_intents/pi_3/cancel', {})).rejects.toThrow('down');
    expect(calls).toHaveLength(1);
  });

  it('wraps Stripe errors as 502 with Stripe’s message and no key', async () => {
    answers.push(fail(400, `Invalid API Key provided: ${SECRET}`));
    const err = (await stripeProvider()
      .refund({ref: 'pi_4', amountCents: 500, currency: 'USD', idempotencyKey: 'refund-1-order'})
      .catch((e: unknown) => e)) as {status: number; code: string; message: string};
    expect(err).toMatchObject({status: 502, code: 'PAYMENT_PROVIDER_ERROR'});
    expect(err.message).toMatch(/^Stripe: Invalid API Key provided/);
    expect(err.message).not.toContain(SECRET);
    expect(new Headers(calls[0]!.init.headers).get('idempotency-key')).toBe('refund-1-order');
    expect(providerError(new Error('x')).message).toBe('Stripe: x');
  });

  it('cancel falls back to the intent’s current state', async () => {
    answers.push(fail(400, 'already succeeded'), ok({id: 'pi_5', status: 'succeeded'}));
    expect((await stripeProvider().cancelIntent('pi_5')).status).toBe('succeeded');
  });

  it('refuses without the secret key', async () => {
    delete env.STRIPE_SECRET_KEY;
    await expect(stripeProvider().getIntent('pi_6')).rejects.toMatchObject({status: 502});
    expect(calls).toHaveLength(0);
  });
});

describe('intentInfo', () => {
  it('maps brands, other methods and failures', () => {
    expect(intentInfo({id: 'pi', status: 's', payment_method: {id: 'pm', type: 'card', card: {brand: 'cartes_bancaires', last4: '1234'}}}).brand).toBe('Cartes Bancaires');
    expect(intentInfo({id: 'pi', status: 's', payment_method: {id: 'pm', type: 'us_bank_account'}}).brand).toBe('Us bank account');
    expect(intentInfo({id: 'pi', status: 's', payment_method: 'pm_1'}).brand).toBeNull();
    expect(intentInfo({id: 'pi', status: 's', last_payment_error: {message: 'x'.repeat(600)}}).failureMessage).toHaveLength(500);
    expect(intentInfo({id: 'pi', status: 's', payment_method: {id: 'pm', type: 'a_very_long_payment_method_type_name'}}).brand).toHaveLength(20);
  });
});

describe('payment config', () => {
  afterEach(() => {
    delete env.STRIPE_SECRET_KEY;
  });
  const dbWith = (row: Record<string, unknown> | null) => ({setting: {findUnique: async () => row}}) as never;

  it('uses Stripe only when it is selected and fully configured', async () => {
    const row = {paymentProvider: 'stripe', stripePublishableKey: 'pk_test_abc', currency: 'eur', storeName: 'VAREL'};
    expect(await paymentConfig(dbWith(row))).toEqual({provider: 'simulated', selected: 'stripe', publishableKey: null, currency: 'EUR', storeName: 'VAREL'});
    env.STRIPE_SECRET_KEY = SECRET;
    expect(await paymentConfig(dbWith(row))).toMatchObject({provider: 'stripe', publishableKey: 'pk_test_abc'});
    expect(await paymentConfig(dbWith({...row, stripePublishableKey: 'nope'}))).toMatchObject({provider: 'simulated', publishableKey: null});
    expect(await paymentConfig(dbWith({...row, paymentProvider: 'simulated'}))).toMatchObject({provider: 'simulated', selected: 'simulated'});
    expect(await paymentConfig(dbWith(null))).toEqual({provider: 'simulated', selected: 'simulated', publishableKey: null, currency: 'USD', storeName: 'VAREL'});
    expect(stripeReady('pk_live_x', 'sk')).toBe(true);
    expect(stripeReady('pk_x', 'sk')).toBe(false);
  });

  it('reads the key mode and exposes the webhook contract', () => {
    expect(keyMode('sk_test_1')).toBe('test');
    expect(keyMode('pk_live_1')).toBe('live');
    expect(keyMode('rk_test_1')).toBe('test');
    expect(keyMode('whsec_1')).toBeNull();
    expect(keyMode(null)).toBeNull();
    expect(STRIPE_WEBHOOK_PATH).toBe('/site-api/webhooks/stripe');
    expect(STRIPE_WEBHOOK_EVENTS).toContain('charge.refunded');
  });
});
