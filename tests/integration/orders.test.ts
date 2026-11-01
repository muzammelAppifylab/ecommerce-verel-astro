import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const sent = vi.hoisted(() => ({calls: [] as {key: string; to: string; vars: Record<string, unknown>}[], refundFails: false}));

vi.mock('../../src/server/lib/contracts', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/server/lib/contracts')>();
  const {HttpError} = await import('../../src/server/lib/errors');
  return {
    ...real,
    sendTemplate: async (_db: unknown, key: string, to: string, vars: Record<string, unknown>) => {
      sent.calls.push({key, to, vars});
    },
    refundOrder: async (db: unknown, order: unknown, cents: number, reason: string) => {
      if (sent.refundFails) throw new HttpError(502, 'payment_provider_error', 'Stripe: card declined');
      return real.refundOrder(db as never, order as never, cents, reason);
    },
  };
});

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

let seq = 0;
async function makeOrder(over: Record<string, unknown> = {}, items = 1) {
  seq += 1;
  return db.shopOrder.create({
    data: {
      number: `VRL-${10000 + seq}`,
      email: 'guest@example.test',
      method: 'Standard',
      subtotalCents: 14800,
      totalCents: 14800,
      payment: 'Paid',
      fulfillment: 'Unfulfilled',
      stage: 1,
      note: 'STAFF ONLY',
      placedAt: new Date(Date.UTC(2026, 0, 1) + seq * 60_000),
      ...over,
      items: {
        create: Array.from({length: items}, (_, i) => ({
          name: `Piece ${i + 1}`,
          category: 'Coats',
          sku: `SKU-${i + 1}`,
          qty: 2,
          priceCents: 7400,
          image: {src: 'https://img.example/x.jpg', alt: ''},
          position: i,
        })),
      },
    },
    select: {id: true, number: true},
  });
}

describe.skipIf(!DATABASE_URL)('customer orders (integration, real Postgres)', () => {
  let mira: Browser;
  let miraId: number;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    sent.calls.length = 0;
    sent.refundFails = false;
    mira = await signedIn(app, 'mira@example.test', undefined, '203.0.113.21');
    miraId = await userId('mira@example.test');
  });

  describe('GET /orders', () => {
    it('asks guests to sign in', async () => {
      expect((await new Browser(app).get('/site-api/orders')).status).toBe(401);
    });

    it('lists own and verified guest-email orders, never another account’s', async () => {
      const own = await makeOrder({userId: miraId, email: 'other@example.test'});
      const guestOrder = await makeOrder({email: 'mira@example.test'});
      await makeOrder({email: 'someone@example.test'});
      await signedIn(app, 'bob@example.test', undefined, '203.0.113.22');
      await makeOrder({userId: await userId('bob@example.test'), email: 'mira@example.test'});
      const res = await mira.get('/site-api/orders');
      expect(res.status).toBe(200);
      const numbers = (res.json.items as {number: string}[]).map(o => o.number);
      expect(numbers.sort()).toEqual([own.number, guestOrder.number].sort());
      expect(res.json.nextCursor).toBeNull();
      expect(JSON.stringify(res.json)).not.toContain('STAFF ONLY');
    });

    it('filters by status (cancelled only under all)', async () => {
      await makeOrder({userId: miraId, fulfillment: 'Shipped'});
      await makeOrder({userId: miraId, fulfillment: 'Delivered'});
      await makeOrder({userId: miraId, fulfillment: 'Returned'});
      await makeOrder({userId: miraId, fulfillment: 'Cancelled'});
      const count = async (q: string) => ((await mira.get(`/site-api/orders${q}`)).json.items as unknown[]).length;
      expect(await count('')).toBe(4);
      expect(await count('?status=open')).toBe(1);
      expect(await count('?status=completed')).toBe(1);
      expect(await count('?status=returned')).toBe(1);
      expect((await mira.get('/site-api/orders?status=cancelled')).status).toBe(422);
    });

    it('pages with a keyset cursor', async () => {
      for (let i = 0; i < 5; i++) await makeOrder({userId: miraId});
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r = await mira.get(`/site-api/orders?pageSize=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(r.status).toBe(200);
        seen.push(...(r.json.items as {number: string}[]).map(o => o.number));
        cursor = r.json.nextCursor as string | null;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(5);
      // Newest first.
      expect([...seen]).toEqual([...seen].sort().reverse());
    });
  });

  describe('GET /orders/:number', () => {
    it('owner, guest with email (any case), wrong email, signed out', async () => {
      const o = await makeOrder({userId: miraId});
      const g = await makeOrder({email: 'guest@example.test'});
      expect((await mira.get(`/site-api/orders/${o.number}`)).status).toBe(200);
      const short = o.number.replace('VRL-', '');
      expect((await mira.get(`/site-api/orders/${short}`)).json.number).toBe(o.number);
      const anon = new Browser(app);
      expect((await anon.get(`/site-api/orders/${g.number}?email=GUEST@example.test`)).status).toBe(200);
      expect((await anon.get(`/site-api/orders/${g.number}?email=nope@example.test`)).status).toBe(404);
      expect((await anon.get(`/site-api/orders/${g.number}`)).status).toBe(401);
      expect((await mira.get(`/site-api/orders/${g.number}`)).status).toBe(404);
      const body = (await mira.get(`/site-api/orders/${o.number}`)).json;
      expect(JSON.stringify(body)).not.toContain('STAFF ONLY');
    });
  });

  describe('POST /orders/:number/cancel', () => {
    it('paid: cancels, refunds, records the event, emails once', async () => {
      const o = await makeOrder({userId: miraId});
      const r = await mira.post(`/site-api/orders/${o.number}/cancel`, {reason: 'wrong_size'});
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({fulfillment: 'Cancelled', payment: 'Refunded', canCancel: false});
      const ev = await db.shopOrderEvent.findFirstOrThrow({where: {orderId: o.id}});
      expect(ev.message).toMatch(/^Cancelled by the customer · Wrong size or colour · Refunded /);
      expect(ev.by).toBe('Customer');
      expect(sent.calls.map(c => c.key)).toEqual(['order_refunded']);
      expect(sent.calls[0]!.vars.refundAmount).toBe('$148');
      const again = await mira.post(`/site-api/orders/${o.number}/cancel`, {});
      expect(again.status).toBe(409);
      expect(again.json.error).toBe('already_cancelled');
    });

    it('pending: cancelled, payment stays pending, no email', async () => {
      const o = await makeOrder({userId: miraId, payment: 'Pending'});
      const r = await mira.post(`/site-api/orders/${o.number}/cancel`, {});
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({fulfillment: 'Cancelled', payment: 'Pending'});
      expect(sent.calls).toHaveLength(0);
    });

    it('being packed → 409 not_cancellable', async () => {
      const o = await makeOrder({userId: miraId, fulfillment: 'Processing', stage: 2});
      const r = await mira.post(`/site-api/orders/${o.number}/cancel`, {});
      expect(r.status).toBe(409);
      expect(r.json.error).toBe('not_cancellable');
    });

    it('a refused refund puts the order back', async () => {
      const o = await makeOrder({userId: miraId});
      sent.refundFails = true;
      const r = await mira.post(`/site-api/orders/${o.number}/cancel`, {});
      expect(r.status).toBe(502);
      const row = await db.shopOrder.findUniqueOrThrow({where: {id: o.id}, select: {fulfillment: true, payment: true}});
      expect(row).toEqual({fulfillment: 'Unfulfilled', payment: 'Paid'});
    });

    it('a guest cancels with the order email', async () => {
      const g = await makeOrder({email: 'guest@example.test'});
      const anon = new Browser(app);
      expect((await anon.post(`/site-api/orders/${g.number}/cancel`, {email: 'nope@example.test'})).status).toBe(404);
      const r = await anon.post(`/site-api/orders/${g.number}/cancel`, {email: 'guest@example.test'});
      expect(r.status).toBe(200);
      expect(r.json.fulfillment).toBe('Cancelled');
    });
  });
});
