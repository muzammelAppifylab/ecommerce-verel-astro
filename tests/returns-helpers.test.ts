import {describe, expect, it} from 'vitest';

import type {Db} from '../src/server/lib/contracts';
import {makeLoc} from '../src/server/lib/i18n/localize';
import {checkReturnItems, eligibility, remainingByLine} from '../src/server/routes/returns';

describe('remainingByLine', () => {
  it('sums numeric and numeric-string line ids, skips bad entries, floors quantities', () => {
    const m = remainingByLine([
      {items: [{lineId: 1, qty: 1}, {lineId: '2', qty: 2.7}]},
      {items: [{lineId: 1, qty: 2}, {lineId: 'x', qty: 5}, {lineId: 3, qty: -4}, null, 'junk']},
      {items: 'not an array'},
    ]);
    expect(m.get(1)).toBe(3);
    expect(m.get(2)).toBe(2);
    expect(m.get(3)).toBe(0);
    expect(m.size).toBe(3);
  });
});

describe('checkReturnItems', () => {
  const lines = [
    {id: 1, qty: 2, digital: false},
    {id: 2, qty: 1, digital: true},
  ];
  it('flags unknown and digital lines', () => {
    expect(checkReturnItems(lines, [{lineId: 9, qty: 1}], new Map())).toEqual({
      'items.0.lineId': 'That piece is not part of this order',
    });
    expect(checkReturnItems(lines, [{lineId: 2, qty: 1}], new Map())).toEqual({
      'items.0.lineId': 'Digital products cannot be returned',
    });
  });
  it('counts previous requests and sums duplicates in the body', () => {
    expect(checkReturnItems(lines, [{lineId: 1, qty: 2}], new Map())).toEqual({});
    expect(checkReturnItems(lines, [{lineId: 1, qty: 2}], new Map([[1, 1]]))).toEqual({
      'items.0.qty': 'That is more than is left to return',
    });
    expect(
      checkReturnItems(
        lines,
        [
          {lineId: 1, qty: 1},
          {lineId: 1, qty: 2},
        ],
        new Map()
      )
    ).toEqual({'items.1.qty': 'That is more than is left to return'});
  });
});

describe('eligibility', () => {
  const day = 86_400_000;
  const placedAt = new Date('2026-01-01T00:00:00Z');
  const fakeDb = (at: Date | null) =>
    ({shopOrderEvent: {findFirst: async () => (at ? {at} : null)}}) as unknown as Db;
  const order = (payment: string, fulfillment: string) => ({id: 1, payment, fulfillment, placedAt});

  it('refunded comes first', async () => {
    const r = await eligibility(fakeDb(null), order('Refunded', 'Delivered'), 30);
    expect(r).toEqual({eligible: false, reason: 'This order has already been refunded'});
  });
  it('delivered inside / outside the window (event, else the order date)', async () => {
    const delivered = new Date(placedAt.getTime() + 20 * day);
    const now = placedAt.getTime() + 40 * day;
    expect(await eligibility(fakeDb(delivered), order('Paid', 'Delivered'), 30, undefined, now)).toEqual({eligible: true});
    const closed = await eligibility(fakeDb(null), order('Paid', 'Delivered'), 30, undefined, now);
    expect(closed.eligible).toBe(false);
    expect(closed.reason).toMatch(/30 days/);
  });
  it('returned, then not yet delivered', async () => {
    expect((await eligibility(fakeDb(null), order('Paid', 'Returned'), 30)).reason).toMatch(/returned/);
    for (const f of ['Shipped', 'Unfulfilled', 'Cancelled', 'Processing']) {
      expect(await eligibility(fakeDb(null), order('Paid', f), 30)).toEqual({
        eligible: false,
        reason: 'Returns open once your order has been delivered',
      });
    }
  });
  it('answers in the request language', async () => {
    const r = await eligibility(fakeDb(null), order('Refunded', 'Delivered'), 30, makeLoc('da'));
    expect(r.reason).toBe('Denne ordre er allerede refunderet');
  });
});
