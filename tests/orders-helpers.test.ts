import {describe, expect, it} from 'vitest';

import type {Order} from '../src/lib/types/orders';
import {
  cancelEventText,
  canSeeOrder,
  emailMoney,
  isOrderOwner,
  maskEmail,
  orderUrlOf,
  ownerWhere,
  redactOrder,
} from '../src/server/routes/orders';
import type {Viewer} from '../src/platform/types';

const user = (over: Partial<Viewer> = {}): Viewer =>
  ({state: 'user', id: 7, email: 'Mira@Studio.dk', emailVerified: true, ...over}) as unknown as Viewer;
const guest = {state: 'guest'} as unknown as Viewer;

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('mira@studio.dk')).toBe('m***@studio.dk');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
  });
  it('hides anything that is not an address', () => {
    expect(maskEmail('nobody')).toBe('***');
    expect(maskEmail('@x.dk')).toBe('***');
  });
});

describe('redactOrder', () => {
  const order = {
    number: 'VRL-1',
    email: 'mira@studio.dk',
    phone: '+45 1234',
    address: {name: 'Mira', line1: 'Street 1', city: 'Cph', zip: '1000', country: 'Denmark'},
    billingSameAsShipping: false,
    cardBrand: 'Visa',
    cardLast4: '4242',
    tracking: 'TR1',
    trackingUrl: 'https://track.example/TR1',
    customerNote: 'Leave at the door',
    discountCode: 'AUTUMN',
    canCancel: true,
    total: 148,
    items: [{lineId: '1', name: 'Coat', qty: 1, price: 148, download: 'file.pdf'}],
  } as unknown as Order;

  it('drops every personal field and download link, keeps lines and amounts', () => {
    const r = redactOrder(order);
    expect(r.email).toBe('m***@studio.dk');
    expect(r.phone).toBeNull();
    expect(r.address).toBeNull();
    expect(r.billingSameAsShipping).toBe(true);
    expect(r.cardBrand).toBeNull();
    expect(r.cardLast4).toBeNull();
    expect(r.tracking).toBeNull();
    expect(r.trackingUrl).toBeNull();
    expect(r.customerNote).toBeNull();
    expect(r.discountCode).toBeNull();
    expect(r.canCancel).toBe(false);
    expect(r.items[0]!.download).toBeNull();
    expect(r.items[0]!.name).toBe('Coat');
    expect(r.total).toBe(148);
  });
});

describe('cancelEventText', () => {
  it('paid, with a reason and restocked pieces', () => {
    expect(cancelEventText({reason: 'wrong_size', paid: true, refundedCents: 14800, currency: 'USD', units: 2})).toMatch(
      /^Cancelled by the customer · Wrong size or colour · Refunded .*148.* · 2 items restocked$/
    );
  });
  it('unpaid, no reason, one or no pieces', () => {
    expect(cancelEventText({paid: false, refundedCents: 0, currency: 'USD', units: 1})).toBe(
      'Cancelled by the customer · 1 item restocked'
    );
    expect(cancelEventText({paid: false, refundedCents: 0, currency: 'USD', units: 0})).toBe('Cancelled by the customer');
  });
});

describe('emailMoney', () => {
  it('drops decimals on whole amounts', () => {
    expect(emailMoney(148, 'USD')).toBe('$148');
    expect(emailMoney(24.6, 'EUR')).toBe('€24.60');
  });
  it('falls back on a bad currency', () => {
    expect(emailMoney(10, 'NOPE!')).toBe('10.00 NOPE!');
  });
});

describe('ownership', () => {
  it('a verified account claims guest orders with its exact (lower-cased) email', () => {
    expect(ownerWhere(user())).toEqual({OR: [{userId: 7}, {userId: null, email: 'mira@studio.dk'}]});
    expect(ownerWhere(user({emailVerified: false}))).toEqual({userId: 7});
  });
  it('isOrderOwner / canSeeOrder', () => {
    expect(isOrderOwner(user(), {userId: 7, email: 'x@y.z'})).toBe(true);
    expect(isOrderOwner(user(), {userId: null, email: 'mira@studio.dk'})).toBe(true);
    expect(isOrderOwner(user({emailVerified: false}), {userId: null, email: 'mira@studio.dk'})).toBe(false);
    // Linked to another account: never by the account email.
    expect(isOrderOwner(user(), {userId: 8, email: 'mira@studio.dk'})).toBe(false);
    expect(isOrderOwner(guest, {userId: null, email: 'mira@studio.dk'})).toBe(false);
    expect(canSeeOrder(guest, {userId: 8, email: 'mira@studio.dk'}, ' MIRA@studio.dk ')).toBe(true);
    expect(canSeeOrder(guest, {userId: 8, email: 'mira@studio.dk'}, 'other@studio.dk')).toBe(false);
  });
  it('orderUrlOf: account page for accounts, confirmation link for guests', () => {
    expect(orderUrlOf('https://s.test', {number: 'VRL-1', email: 'a@b.co', userId: 3})).toBe(
      'https://s.test/account/orders/VRL-1/'
    );
    expect(orderUrlOf('https://s.test', {number: 'VRL-1', email: 'a@b.co', userId: null})).toBe(
      'https://s.test/order/VRL-1/confirmation/?email=a%40b.co'
    );
  });
});
