import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {pruneRateHits, RATE_LIMITS} from '../../src/server/lib/rate-limit';
import {signStripePayload} from '../../src/server/lib/payments/stripe';
import {env} from './support/cloudflare-workers';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn} from './support/harness';

/** I2: the store's own rate limits (`rate_hits`) and the Stripe webhook's signature gate, against Postgres. */
describe.skipIf(!DATABASE_URL)('store rate limits (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(resetDatabase);

  /** Calls `send` until it is refused; returns the statuses. */
  async function until429(send: (i: number) => Promise<{status: number; headers: Headers; json: Record<string, unknown>}>, max: number) {
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof send>> | null = null;
    for (let i = 0; i < max; i++) {
      last = await send(i);
      statuses.push(last.status);
      if (last.status === 429) break;
    }
    return {statuses, last: last!};
  }

  it('contact: per IP, whatever the email; other IPs unaffected', async () => {
    const a = new Browser(app, '198.51.100.1');
    const {limit} = RATE_LIMITS.contact;
    const {statuses, last} = await until429(
      i => a.post('/site-api/contact', {name: 'Mira', email: `m${i}@example.com`, subject: 'Hello', message: 'A question.'}),
      limit + 2
    );
    expect(statuses.slice(0, limit).every(s => s === 204)).toBe(true);
    expect(statuses[limit]).toBe(429);
    expect(last.json).toMatchObject({error: 'rate_limited'});
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    const b = new Browser(app, '198.51.100.2');
    expect((await b.post('/site-api/contact', {name: 'B', email: 'b@example.com', subject: 'Hi', message: 'Hi.'})).status).toBe(204);
    // Subjects are HMACs, never the raw IP.
    const rows = await db.rateHit.findMany({select: {subject: true}, take: 10});
    expect(rows.every(r => /^[0-9a-f]{64}$/.test(r.subject))).toBe(true);
  });

  it('newsletter: per IP', async () => {
    const a = new Browser(app, '198.51.100.3');
    const {limit} = RATE_LIMITS.newsletter;
    const {statuses} = await until429(i => a.post('/site-api/newsletter', {email: `n${i}@example.com`}), limit + 2);
    expect(statuses.slice(0, limit).every(s => s === 204)).toBe(true);
    expect(statuses[limit]).toBe(429);
  });

  it('returns look-up: per IP, before the order is looked up', async () => {
    const a = new Browser(app, '198.51.100.4');
    const {limit} = RATE_LIMITS.returnsLookup;
    const {statuses} = await until429(i => a.post('/site-api/returns/lookup', {order: `VRL-${1000 + i}`, email: 'x@example.com'}), limit + 2);
    expect(statuses.slice(0, limit).every(s => s === 404)).toBe(true);
    expect(statuses[limit]).toBe(429);
  });

  it('guest order look-ups by email: per IP', async () => {
    const a = new Browser(app, '198.51.100.5');
    const {limit} = RATE_LIMITS.orderLookup;
    const {statuses} = await until429(i => a.get(`/site-api/orders/VRL-${2000 + i}?email=x%40example.com`), limit + 2);
    expect(statuses.slice(0, limit).every(s => s === 404)).toBe(true);
    expect(statuses[limit]).toBe(429);
  });

  it('guest downloads by order + email: per IP', async () => {
    const a = new Browser(app, '198.51.100.6');
    const {limit} = RATE_LIMITS.download;
    const {statuses} = await until429(i => a.get(`/site-api/downloads/file-${i}.pdf?order=VRL-1&email=x%40example.com&format=json`), limit + 2);
    expect(statuses.slice(0, limit).every(s => s === 403)).toBe(true);
    expect(statuses[limit]).toBe(429);
  });

  it('account export: per account, not per IP', async () => {
    const me = await signedIn(app, 'mira@example.test', undefined, '198.51.100.7');
    const {limit} = RATE_LIMITS.export;
    const {statuses} = await until429(() => me.get('/site-api/account/export'), limit + 2);
    expect(statuses.slice(0, limit).every(s => s === 200)).toBe(true);
    expect(statuses[limit]).toBe(429);
    // A guest is asked to sign in before anything is counted.
    expect((await new Browser(app, '198.51.100.8').get('/site-api/account/export')).status).toBe(401);
  });

  it('search: per IP', async () => {
    const a = new Browser(app, '198.51.100.9');
    const {limit} = RATE_LIMITS.search;
    const {statuses} = await until429(() => a.get('/site-api/search?q=linen'), limit + 2);
    expect(statuses.slice(0, limit).every(s => s === 200)).toBe(true);
    expect(statuses[limit]).toBe(429);
  }, 60_000);

  it('prunes old hits in bounded batches', async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    await db.rateHit.createMany({data: Array.from({length: 600}, () => ({kind: 'contact', subject: 'a'.repeat(64), createdAt: old}))});
    expect(await pruneRateHits(db as never, new Date(Date.now() - 24 * 60 * 60_000))).toBe(500);
    expect(await pruneRateHits(db as never, new Date(Date.now() - 24 * 60 * 60_000))).toBe(100);
  });
});

describe.skipIf(!DATABASE_URL)('Stripe webhook gate (integration)', () => {
  const event = {id: 'evt_gate', type: 'payment_intent.succeeded', data: {object: {id: 'pi_none', status: 'succeeded'}}};
  const post = (body: string, headers: Record<string, string>) =>
    app.request('https://shop.example.test/site-api/webhooks/stripe', {
      method: 'POST',
      // Cross-site, no CSRF token: the signature is the only credential.
      headers: {'content-type': 'application/json', origin: 'https://hooks.stripe.example', ...headers},
      body,
    });

  beforeAll(() => {
    configureEnv();
    env.STRIPE_WEBHOOK_SECRET = 'whsec_gate';
  });
  afterAll(() => {
    delete env.STRIPE_WEBHOOK_SECRET;
  });

  it('accepts a signed event cross-site, without a CSRF token', async () => {
    const body = JSON.stringify(event);
    const res = await post(body, {'stripe-signature': await signStripePayload(body, 'whsec_gate')});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({received: true});
  });

  it('refuses a missing, wrong, stale or tampered signature before parsing', async () => {
    const body = JSON.stringify(event);
    expect((await post(body, {})).status).toBe(400);
    expect((await post(body, {'stripe-signature': await signStripePayload(body, 'whsec_other')})).status).toBe(400);
    const stale = await signStripePayload(body, 'whsec_gate', Math.floor(Date.now() / 1000) - 600);
    expect((await post(body, {'stripe-signature': stale})).status).toBe(400);
    const sig = await signStripePayload(body, 'whsec_gate');
    expect((await post(body.replace('pi_none', 'pi_evil'), {'stripe-signature': sig})).status).toBe(400);
    // Not JSON, but signed: refused as a bad event, never a crash.
    const junk = 'not json';
    expect((await post(junk, {'stripe-signature': await signStripePayload(junk, 'whsec_gate')})).status).toBe(400);
  });

  it('refuses a body over 512 KB', async () => {
    const big = JSON.stringify({...event, pad: 'x'.repeat(600 * 1024)});
    const res = await post(big, {'stripe-signature': await signStripePayload(big, 'whsec_gate')});
    expect(res.status).toBe(413);
  });

  it('answers 503 when the owner has not added the webhook secret', async () => {
    delete env.STRIPE_WEBHOOK_SECRET;
    const body = JSON.stringify(event);
    const res = await post(body, {'stripe-signature': await signStripePayload(body, 'whsec_gate')});
    expect(res.status).toBe(503);
    env.STRIPE_WEBHOOK_SECRET = 'whsec_gate';
  });
});
