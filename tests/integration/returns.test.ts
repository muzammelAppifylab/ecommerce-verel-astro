import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

const DAY = 86_400_000;
let seq = 0;

async function makeOrder(over: Record<string, unknown> = {}, lines: {qty: number; digital?: boolean}[] = [{qty: 2}]) {
  seq += 1;
  const o = await db.shopOrder.create({
    data: {
      number: `VRL-${20000 + seq}`,
      email: 'guest@example.test',
      phone: '+45 11 22 33 44',
      address: {name: 'Guest Person', line1: 'Street 1', city: 'Copenhagen', zip: '1000', country: 'Denmark'},
      cardBrand: 'Visa',
      cardLast4: '4242',
      method: 'Standard',
      subtotalCents: 14800,
      totalCents: 14800,
      payment: 'Paid',
      fulfillment: 'Delivered',
      stage: 4,
      placedAt: new Date(Date.now() - 5 * DAY),
      ...over,
      items: {
        create: lines.map((l, i) => ({
          name: `Piece ${i + 1}`,
          category: 'Coats',
          sku: `SKU-${i + 1}`,
          qty: l.qty,
          digital: !!l.digital,
          priceCents: 7400,
          image: {src: 'https://img.example/x.jpg', alt: ''},
          position: i,
        })),
      },
    },
    select: {id: true, number: true, items: {select: {id: true}, orderBy: {position: 'asc'}}},
  });
  return {...o, lineIds: o.items.map(i => i.id)};
}

describe.skipIf(!DATABASE_URL)('returns (integration, real Postgres)', () => {
  let anon: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    anon = new Browser(app, '203.0.113.31');
  });

  describe('POST /returns/lookup', () => {
    it('unknown number and wrong email → 404', async () => {
      const unknown = await anon.post('/site-api/returns/lookup', {order: '99999'});
      expect(unknown.status).toBe(404);
      expect(unknown.json.error).toBe('order_not_found');
      const o = await makeOrder();
      const wrong = await anon.post('/site-api/returns/lookup', {order: o.number, email: 'nope@example.test'});
      expect(wrong.status).toBe(404);
      expect(wrong.json.message).toBe('That order number and email do not match');
    });

    it('number only → redacted', async () => {
      const o = await makeOrder();
      const r = await anon.post('/site-api/returns/lookup', {order: o.number.replace('VRL-', '')});
      expect(r.status).toBe(200);
      expect(r.json.access).toBe('number');
      expect(r.json.eligible).toBe(true);
      const order = r.json.order as Record<string, unknown>;
      expect(order.email).toBe('g***@example.test');
      expect(order.phone).toBeNull();
      expect(order.address).toBeNull();
      expect(order.cardLast4).toBeNull();
    });

    it('owner → full order', async () => {
      const mira = await signedIn(app, 'mira@example.test', undefined, '203.0.113.32');
      const o = await makeOrder({userId: await userId('mira@example.test')});
      const r = await mira.post('/site-api/returns/lookup', {order: o.number});
      expect(r.json.access).toBe('owner');
      expect((r.json.order as Record<string, unknown>).phone).toBe('+45 11 22 33 44');
    });

    it('window closed, not delivered, refunded', async () => {
      const old = await makeOrder({placedAt: new Date(Date.now() - 60 * DAY)});
      const closed = await anon.post('/site-api/returns/lookup', {order: old.number, email: 'guest@example.test'});
      expect(closed.json).toMatchObject({eligible: false, access: 'email'});
      expect(closed.json.reason).toMatch(/30 days/);
      // A recent delivery event reopens the window.
      await db.shopOrderEvent.create({data: {orderId: old.id, kind: 'status', message: 'Marked as delivered', at: new Date()}});
      expect((await anon.post('/site-api/returns/lookup', {order: old.number})).json.eligible).toBe(true);
      const shipped = await makeOrder({fulfillment: 'Shipped', stage: 3});
      expect((await anon.post('/site-api/returns/lookup', {order: shipped.number})).json.reason).toBe(
        'Returns open once your order has been delivered'
      );
      const refunded = await makeOrder({payment: 'Refunded'});
      expect((await anon.post('/site-api/returns/lookup', {order: refunded.number})).json.reason).toBe(
        'This order has already been refunded'
      );
    });
  });

  describe('POST /returns', () => {
    const item = (lineId: number, qty = 1) => ({lineId, qty, reason: 'Too big'});

    it('needs the email when only the number is known', async () => {
      const o = await makeOrder();
      const r = await anon.post('/site-api/returns', {order: o.number, items: [item(o.lineIds[0]!)]});
      expect(r.status).toBe(422);
      expect((r.json.fields as Record<string, string>).email).toBeTruthy();
    });

    it('validates the body', async () => {
      const o = await makeOrder();
      const empty = await anon.post('/site-api/returns', {order: o.number, email: 'guest@example.test', items: []});
      expect(empty.status).toBe(422);
      expect(JSON.stringify(empty.json)).toContain('Choose at least one piece to return');
      const long = await anon.post('/site-api/returns', {
        order: o.number,
        email: 'guest@example.test',
        items: [{lineId: o.lineIds[0], qty: 1, reason: 'x'.repeat(301)}],
      });
      expect(long.status).toBe(422);
    });

    it('refuses ineligible orders, digital lines and too many pieces', async () => {
      const shipped = await makeOrder({fulfillment: 'Shipped', stage: 3});
      const r1 = await anon.post('/site-api/returns', {order: shipped.number, email: 'guest@example.test', items: [item(shipped.lineIds[0]!)]});
      expect(r1.status).toBe(422);
      expect(r1.json.error).toBe('return_not_eligible');

      const o = await makeOrder({}, [{qty: 2}, {qty: 1, digital: true}]);
      const base = {order: o.number, email: 'guest@example.test'};
      const digital = await anon.post('/site-api/returns', {...base, items: [item(o.lineIds[1]!)]});
      expect((digital.json.fields as Record<string, string>)['items.0.lineId']).toBe('Digital products cannot be returned');
      const dup = await anon.post('/site-api/returns', {...base, items: [item(o.lineIds[0]!), item(o.lineIds[0]!, 2)]});
      expect((dup.json.fields as Record<string, string>)['items.1.qty']).toBe('That is more than is left to return');

      const ok = await anon.post('/site-api/returns', {...base, items: [item(o.lineIds[0]!)]});
      expect(ok.status).toBe(201);
      const over = await anon.post('/site-api/returns', {...base, items: [item(o.lineIds[0]!, 2)]});
      expect((over.json.fields as Record<string, string>)['items.0.qty']).toBe('That is more than is left to return');
    });

    it('books a return: numeric line ids, a timeline event', async () => {
      const o = await makeOrder();
      const r = await anon.post('/site-api/returns', {
        order: o.number,
        email: 'GUEST@example.test',
        items: [{lineId: String(o.lineIds[0]), qty: 2, reason: 'Too big'}],
      });
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({status: 'Requested'});
      const row = await db.returnRequest.findFirstOrThrow({where: {orderId: o.id}});
      expect((row.items as {lineId: unknown}[])[0]!.lineId).toBe(o.lineIds[0]);
      expect(row.email).toBe('guest@example.test');
      const ev = await db.shopOrderEvent.findFirstOrThrow({where: {orderId: o.id, kind: 'return'}});
      expect(ev.message).toBe('Return requested · 2 items');
    });

    it('caps requests per order', async () => {
      const o = await makeOrder({}, [{qty: 999}]);
      await db.returnRequest.createMany({
        data: Array.from({length: 50}, () => ({orderId: o.id, email: 'guest@example.test', items: []})),
      });
      const r = await anon.post('/site-api/returns', {order: o.number, email: 'guest@example.test', items: [item(o.lineIds[0]!)]});
      expect(r.status).toBe(429);
    });
  });
});
