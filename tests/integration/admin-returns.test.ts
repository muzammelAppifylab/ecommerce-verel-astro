import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import * as contracts from '../../src/server/lib/contracts';
import {app} from '../../src/server/app';
import {makeOrder, seedCatalog, staffSetup} from './support/sales-fixtures';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/** WP-19: `/site-api/manage/returns` against Postgres (guards, list, transitions, refunds). */

const inventory = async (id: string) => (await db.variant.findUnique({where: {id}, select: {inventory: true}}))!.inventory;
const orderOf = (number: string) =>
  db.shopOrder.findUnique({where: {number}, select: {payment: true, fulfillment: true, stage: true}});

describe.skipIf(!DATABASE_URL)('admin returns (integration, real Postgres)', () => {
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
    ({staff, customer} = await staffSetup());
    await seedCatalog();
  });

  /** An order with a return asking for `lines` ([index, qty]) back. */
  async function orderWithReturn(number: string, lines: [number, number][], status = 'Requested', shippingCents = 0) {
    const o = await makeOrder({number, shippingCents});
    const r = await db.returnRequest.create({
      data: {orderId: o.id, email: 'ann@example.test', status, items: lines.map(([i, qty]) => ({lineId: o.items[i]!.id, qty, reason: 'Too small'}))},
      select: {id: true},
    });
    return {order: o, id: r.id};
  }

  it('guards, lists, searches and reads', async () => {
    const a = await orderWithReturn('VRL-40001', [[0, 1]]);
    const b = await orderWithReturn('VRL-40002', [[1, 2]], 'Approved');
    expect((await new Browser(app).get('/site-api/manage/returns')).status).toBe(401);
    expect((await customer.get('/site-api/manage/returns')).status).toBe(403);
    expect((await customer.get(`/site-api/manage/returns/${a.id}`)).status).toBe(403);

    const list = await staff.get('/site-api/manage/returns');
    expect(list.status).toBe(200);
    const items = list.json.items as {id: string; orderNumber: string; amount: number; itemCount: number}[];
    expect(items.map(r => r.orderNumber)).toEqual(['VRL-40002', 'VRL-40001']);
    expect(items[0]).toMatchObject({id: String(b.id), amount: 100, itemCount: 2});

    const ids = async (qs: string) => ((await staff.get(`/site-api/manage/returns?${qs}`)).json.items as {id: string}[]).map(r => r.id);
    expect(await ids('status=Approved')).toEqual([String(b.id)]);
    expect(await ids(`q=${a.id}`)).toEqual([String(a.id)]);
    expect(await ids('q=40001')).toEqual([String(a.id)]);
    expect(await ids('q=ANN@EXAMPLE')).toHaveLength(2);
    expect((await staff.get('/site-api/manage/returns?status=Lost')).status).toBe(422);
    expect((await staff.get('/site-api/manage/returns?sort=status')).status).toBe(422);

    const one = await staff.get(`/site-api/manage/returns/${a.id}`);
    expect(one.status).toBe(200);
    expect(one.json).toMatchObject({orderNumber: 'VRL-40001', order: {number: 'VRL-40001'}});
    expect((one.json.items as {name: string; reason: string; price: number}[])[0]).toMatchObject({name: 'Wool sweater', reason: 'Too small', price: 100});
    expect((await staff.get('/site-api/manage/returns/99999')).status).toBe(404);
    expect((await staff.get('/site-api/manage/returns/abc')).status).toBe(404);
  });

  it('enforces the transitions and emails on status changes only', async () => {
    const {id} = await orderWithReturn('VRL-40003', [[0, 1]]);
    const send = vi.spyOn(contracts, 'sendTemplate');
    const url = `/site-api/manage/returns/${id}`;
    const wrong = await staff.request('PATCH', url, {status: 'Received'});
    expect(wrong.status).toBe(409);
    expect(wrong.json.error).toBe('return_transition');

    expect((await staff.request('PATCH', url, {status: 'Approved', note: 'OK to send'})).json).toMatchObject({status: 'Approved', note: 'OK to send'});
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toBe('return_update');
    // Note-only change: no email, a note event.
    expect((await staff.request('PATCH', url, {status: 'Approved', note: 'Label sent'})).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const events = await db.shopOrderEvent.findMany({orderBy: [{at: 'asc'}, {id: 'asc'}], select: {kind: true, message: true}});
    expect(events.map(e => e.message)).toEqual(['Return approved · OK to send', 'Return note · Label sent']);

    expect((await staff.request('PATCH', url, {status: 'Rejected'})).status).toBe(200);
    expect((await staff.request('PATCH', url, {status: 'Requested'})).json).toMatchObject({status: 'Requested'});
    expect((await staff.request('PATCH', url, {status: 'Nope'})).status).toBe(422);
  });

  it('refunds a return: restocks its lines, marks the order returned; refunded is final', async () => {
    const {id} = await orderWithReturn('VRL-40004', [[1, 1]], 'Received');
    const refundSpy = vi.spyOn(contracts, 'refundOrder');
    const res = await staff.request('PATCH', `/site-api/manage/returns/${id}`, {status: 'Refunded'});
    expect(res.status).toBe(200);
    expect(refundSpy.mock.calls[0]![2]).toBe(5000);
    expect(refundSpy.mock.calls[0]![3]).toBe(`refund-return-${id}`);
    expect(await inventory('WS-L')).toBe(6);
    expect(await orderOf('VRL-40004')).toEqual({payment: 'Paid', fulfillment: 'Returned', stage: 4});
    const msgs = (await db.shopOrderEvent.findMany({orderBy: [{at: 'asc'}, {id: 'asc'}], select: {message: true}})).map(e => e.message);
    expect(msgs).toEqual(['Return refunded', 'Return refunded $50 · 1 item restocked']);

    const closed = await staff.request('PATCH', `/site-api/manage/returns/${id}`, {status: 'Approved'});
    expect(closed.status).toBe(409);
    expect(closed.json.error).toBe('return_closed');
    expect((await staff.request('PATCH', `/site-api/manage/returns/${id}`, {status: 'Refunded', note: 'Paid by card'})).status).toBe(200);
  });

  it('the return completing the order refunds shipping and marks it refunded', async () => {
    await db.setting.update({where: {id: 1}, data: {refundShipping: true}});
    const {order, id} = await orderWithReturn('VRL-40005', [[0, 1]], 'Refunded', 1000);
    const second = await db.returnRequest.create({
      data: {orderId: order.id, email: 'ann@example.test', status: 'Approved', items: [{lineId: order.items[1]!.id, qty: 2, reason: 'Colour'}]},
      select: {id: true},
    });
    expect(id).toBeTruthy();
    const refundSpy = vi.spyOn(contracts, 'refundOrder');
    const res = await staff.request('PATCH', `/site-api/manage/returns/${second.id}`, {status: 'Refunded'});
    expect(res.status).toBe(200);
    expect(refundSpy.mock.calls[0]![2]).toBe(11000);
    expect(await orderOf('VRL-40005')).toEqual({payment: 'Refunded', fulfillment: 'Returned', stage: 4});
    const last = await db.shopOrderEvent.findFirst({orderBy: [{at: 'desc'}, {id: 'desc'}], select: {message: true}});
    expect(last!.message).toBe('Return refunded $110 · 2 items restocked · order marked refunded');
  });

  it('refuses a return refund once the whole order is refunded; one of two concurrent refunds wins', async () => {
    const a = await orderWithReturn('VRL-40006', [[0, 1]], 'Approved');
    await db.shopOrder.update({where: {id: a.order.id}, data: {payment: 'Refunded'}});
    const refused = await staff.request('PATCH', `/site-api/manage/returns/${a.id}`, {status: 'Refunded'});
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe('order_refunded');

    const b = await orderWithReturn('VRL-40007', [[0, 1]], 'Received');
    const [one, two] = await Promise.all([
      staff.request('PATCH', `/site-api/manage/returns/${b.id}`, {status: 'Refunded'}),
      staff.request('PATCH', `/site-api/manage/returns/${b.id}`, {status: 'Refunded'}),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(await inventory('WS-M')).toBe(6);
  });
});
