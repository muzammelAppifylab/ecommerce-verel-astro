import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import * as contracts from '../../src/server/lib/contracts';
import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';
import {makeOrder, seedCatalog, staffSetup} from './support/sales-fixtures';

/** WP-19: `/site-api/manage/orders` against Postgres (guards, list, CSV, detail, PATCH, refund). */

const inventory = async (id: string) => (await db.variant.findUnique({where: {id}, select: {inventory: true}}))!.inventory;

describe.skipIf(!DATABASE_URL)('admin orders (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
    ({owner, staff, customer} = await staffSetup());
    await seedCatalog();
  });

  it('guards every route', async () => {
    await makeOrder();
    const guest = new Browser(app);
    for (const path of ['/site-api/manage/orders', '/site-api/manage/orders/export.csv', '/site-api/manage/orders/VRL-24817']) {
      expect((await guest.get(path)).status).toBe(401);
      expect((await customer.get(path)).status).toBe(403);
      expect((await staff.get(path)).status).toBe(200);
      expect((await owner.get(path)).status).toBe(200);
    }
    expect((await customer.request('PATCH', '/site-api/manage/orders/VRL-24817', {note: 'x'})).status).toBe(403);
    expect((await customer.request('POST', '/site-api/manage/orders/VRL-24817/refund', {restock: true})).status).toBe(403);
  });

  it('lists newest first, walks the keyset once, filters and searches', async () => {
    for (let i = 0; i < 7; i++) {
      await makeOrder({
        number: `VRL-2490${i}`,
        email: i === 3 ? 'zed@example.test' : `c${i}@example.test`,
        name: i === 5 ? 'Bjørn Holm' : 'Ann Lee',
        payment: i === 1 ? 'Pending' : 'Paid',
        fulfillment: i === 2 ? 'Shipped' : 'Unfulfilled',
        placedAt: new Date(Date.UTC(2026, 9, 1 + i, 12)),
      });
    }
    const first = await staff.get('/site-api/manage/orders?pageSize=3');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('no-store');
    const page1 = first.json as {items: {number: string; total: number; count: number; customerName: string}[]; nextCursor: string | null};
    expect(page1.items.map(o => o.number)).toEqual(['VRL-24906', 'VRL-24905', 'VRL-24904']);
    expect(page1.items[0]).toMatchObject({total: 209, count: 4, customerName: 'Ann Lee'});
    const seen = [...page1.items.map(o => o.number)];
    let cursor = page1.nextCursor;
    while (cursor) {
      const next = (await staff.get(`/site-api/manage/orders?pageSize=3&cursor=${encodeURIComponent(cursor)}`)).json as typeof page1;
      seen.push(...next.items.map(o => o.number));
      cursor = next.nextCursor;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);

    const numbers = async (qs: string) => ((await staff.get(`/site-api/manage/orders?${qs}`)).json as typeof page1).items.map(o => o.number);
    expect(await numbers('payment=Pending')).toEqual(['VRL-24901']);
    expect(await numbers('fulfillment=Shipped')).toEqual(['VRL-24902']);
    expect(await numbers('from=2026-10-02&to=2026-10-03')).toEqual(['VRL-24902', 'VRL-24901']);
    expect(await numbers('q=24903')).toEqual(['VRL-24903']);
    expect(await numbers('q=ZED')).toEqual(['VRL-24903']);
    expect(await numbers('q=bjørn')).toEqual(['VRL-24905']);
    expect(await numbers('sort=total')).toHaveLength(7);
    expect((await staff.get('/site-api/manage/orders?pageSize=500')).status).toBe(422);

    const badSort = await staff.get('/site-api/manage/orders?sort=secret');
    expect(badSort.status).toBe(422);
    expect((badSort.json.fields as Record<string, string>).sort).toBeTruthy();
    expect((await staff.get('/site-api/manage/orders?payment=Lost')).status).toBe(422);
  });

  it('reads one order by number or digits; 404 otherwise', async () => {
    await makeOrder();
    const res = await staff.get('/site-api/manage/orders/24817');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({number: 'VRL-24817', customer: null, events: [], returns: []});
    expect((await staff.get('/site-api/manage/orders/vrl24817')).status).toBe(200);
    const missing = await staff.get('/site-api/manage/orders/VRL-99999');
    expect(missing.status).toBe(404);
    expect(missing.json.message).toBe('We cannot find that order');
  });

  it('PATCH moves fulfilment, tracks, notes; emails after shipping', async () => {
    await makeOrder();
    const send = vi.spyOn(contracts, 'sendTemplate');
    const url = '/site-api/manage/orders/VRL-24817';

    const processing = await staff.request('PATCH', url, {fulfillment: 'Processing'});
    expect(processing.status).toBe(200);
    expect(processing.json).toMatchObject({fulfillment: 'Processing', stage: 2});

    const shipped = await staff.request('PATCH', url, {fulfillment: 'Shipped', carrier: 'DHL Express', tracking: 'JJD1', trackingUrl: 'https://dhl.example/JJD1'});
    expect(shipped.status).toBe(200);
    const events = shipped.json.events as {message: string; by: string}[];
    expect(events[0]!.message).toBe('Marked as shipped · DHL Express JJD1');
    expect(events).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toBe('order_shipped');

    expect((await staff.request('PATCH', url, {trackingUrl: 'ftp://x'})).status).toBe(422);
    expect((await staff.request('PATCH', url, {fulfillment: 'Cancelled'})).status).toBe(422);

    const noted = await staff.request('PATCH', url, {note: 'Gift wrap'});
    expect(noted.json.note).toBe('Gift wrap');
    expect((noted.json.events as {message: string}[])[0]!.message).toBe('Note · Gift wrap');
    const cleared = await staff.request('PATCH', url, {note: ''});
    expect(cleared.json.note).toBeNull();

    const before = await db.shopOrderEvent.count();
    expect((await staff.request('PATCH', url, {fulfillment: 'Shipped'})).status).toBe(200);
    expect(await db.shopOrderEvent.count()).toBe(before);
  });

  it('PATCH refuses fulfilment moves on cancelled and refunded orders', async () => {
    await makeOrder({number: 'VRL-30001', fulfillment: 'Cancelled'});
    await makeOrder({number: 'VRL-30002', payment: 'Refunded', fulfillment: 'Shipped'});
    const cancelled = await staff.request('PATCH', '/site-api/manage/orders/VRL-30001', {fulfillment: 'Processing'});
    expect(cancelled.status).toBe(409);
    expect(cancelled.json.error).toBe('order_cancelled');
    const refunded = await staff.request('PATCH', '/site-api/manage/orders/VRL-30002', {fulfillment: 'Delivered'});
    expect(refunded.status).toBe(409);
    expect(refunded.json.error).toBe('order_refunded');
    expect((await staff.request('PATCH', '/site-api/manage/orders/VRL-30002', {tracking: 'NEW'})).status).toBe(200);
  });

  it('refunds a paid order once, restocking the remaining units', async () => {
    await makeOrder();
    const res = await staff.request('POST', '/site-api/manage/orders/VRL-24817/refund', {restock: true, note: 'Damaged'});
    expect(res.status).toBe(200);
    expect(res.json.payment).toBe('Refunded');
    expect((res.json.events as {message: string}[])[0]!.message).toBe('Refunded $209 · 3 items restocked · Damaged');
    expect(await inventory('WS-M')).toBe(6);
    expect(await inventory('WS-L')).toBe(7);
    const again = await staff.request('POST', '/site-api/manage/orders/VRL-24817/refund', {restock: true});
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('already_refunded');
  });

  it('refuses unpaid orders; nets out refunded returns; provider failure changes nothing', async () => {
    await makeOrder({number: 'VRL-30003', payment: 'Pending'});
    const pending = await staff.request('POST', '/site-api/manage/orders/VRL-30003/refund', {restock: true});
    expect(pending.status).toBe(409);
    expect(pending.json.error).toBe('not_paid');

    const o = await makeOrder({number: 'VRL-30004'});
    await db.returnRequest.create({data: {orderId: o.id, email: 'ann@example.test', status: 'Refunded', items: [{lineId: o.items[1]!.id, qty: 2, reason: 'Size'}]}});
    const refundSpy = vi.spyOn(contracts, 'refundOrder');
    const res = await staff.request('POST', '/site-api/manage/orders/VRL-30004/refund', {restock: true});
    expect(res.status).toBe(200);
    expect(refundSpy.mock.calls[0]![2]).toBe(10900);
    expect((res.json.events as {message: string}[])[0]!.message).toBe('Refunded $109 · 1 item restocked');
    expect(await inventory('WS-L')).toBe(5);

    await makeOrder({number: 'VRL-30005'});
    refundSpy.mockRejectedValueOnce(Object.assign(new Error('Card network down'), {status: 502}));
    const failed = await staff.request('POST', '/site-api/manage/orders/VRL-30005/refund', {restock: true});
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect((await db.shopOrder.findUnique({where: {number: 'VRL-30005'}, select: {payment: true}}))!.payment).toBe('Paid');
  });

  it('exports a CSV, audited and formula-safe', async () => {
    await makeOrder({name: '=cmd()'});
    const res = await staff.get('/site-api/manage/orders/export.csv?payment=Paid');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="varel-orders-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = String(res.json.text).trim().split('\r\n');
    expect(lines[0]).toBe('Order,Placed,Customer,Email,Payment,Fulfillment,Items,Subtotal,Discount code,Discount,Shipping,Tax,Total,Country,Method,Carrier,Tracking');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(",'=cmd(),");
    const audit = await db.auditEvent.findFirst({where: {action: 'orders_exported'}, select: {action: true}});
    expect(audit).toBeTruthy();
  });
});
