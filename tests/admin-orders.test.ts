import {describe, expect, it} from 'vitest';

import {csvCell, csvText, selectedCsvRows} from '../src/portal/screens/orders/csv';
import {ordersQuery, validateOrdersSearch} from '../src/portal/queries/orders';
import {RETURN_NEXT as PORTAL_RETURN_NEXT, validateReturnsSearch} from '../src/portal/queries/returns';
import {
  actorName,
  clip,
  customerNameOf,
  dateParam,
  emailMoney,
  orderCsvRow,
  ORDERS_CSV_HEADER,
  orderUpdatePlan,
  refundableOf,
  refundMessage,
  returnAmount,
  returnItems,
  searchWords,
  STAGE_FOR,
} from '../src/server/routes/admin/orders';
import {RETURN_NEXT, returnEventMessage, returnIdOf, returnRefundMessage, returnRefundPlan} from '../src/server/routes/admin/returns';

/** WP-19: the pure parts of the orders and returns admin (server and portal). */

const base = {fulfillment: 'Unfulfilled', stage: 1, payment: 'Paid', carrier: null, tracking: null, trackingUrl: null, note: null};

const money0 = {subtotalCents: 20000, discountCents: 0, taxCents: 0, pricesIncludeTax: false, taxRate: null};

describe('status tables', () => {
  it('stage follows fulfilment', () => {
    expect(STAGE_FOR).toEqual({Unfulfilled: 1, Processing: 2, Shipped: 3, Delivered: 4, Returned: 4, Cancelled: 1});
  });

  it('the portal mirrors the server RETURN_NEXT', () => {
    expect(PORTAL_RETURN_NEXT).toEqual(RETURN_NEXT);
  });
});

describe('customerNameOf', () => {
  const o = {email: 'ann@example.test', address: {name: 'Ann Address'}};
  it('profile, then account name, then address name, then email', () => {
    expect(customerNameOf({...o, user: {name: 'Acct', customerProfile: {firstName: 'Ann', lastName: 'Lee'}}})).toBe('Ann Lee');
    expect(customerNameOf({...o, user: {name: 'Acct', customerProfile: {firstName: '', lastName: ''}}})).toBe('Acct');
    expect(customerNameOf({...o, user: null})).toBe('Ann Address');
    expect(customerNameOf({email: 'x@example.test', address: null, user: null})).toBe('x@example.test');
  });
});

describe('returnItems', () => {
  it('accepts numeric and digit-string line ids, drops bad entries, floors qty at 0', () => {
    expect(
      returnItems([
        {lineId: 3, qty: 2, reason: 'Too small'},
        {lineId: '4', qty: 1.7},
        {lineId: 'abc', qty: 1},
        {qty: 1},
        null,
        {lineId: 5, qty: -2, reason: 'x'},
      ])
    ).toEqual([
      {lineId: 3, qty: 2, reason: 'Too small'},
      {lineId: 4, qty: 1, reason: ''},
      {lineId: 5, qty: 0, reason: 'x'},
    ]);
    expect(returnItems(null)).toEqual([]);
    expect(returnItems({lineId: 1})).toEqual([]);
  });
});

describe('refunds', () => {
  const lines = [
    {id: 1, priceCents: 10000, qty: 1, discountCents: 0, sku: 'A', digital: false},
    {id: 2, priceCents: 5000, qty: 2, discountCents: 0, sku: 'B', digital: false},
  ];

  it('a full refund with no returns is the total', () => {
    const r = refundableOf({...money0, totalCents: 20000, items: lines}, []);
    expect(r.amount).toBe(200);
    expect(r.remaining).toEqual([
      {sku: 'A', digital: false, qty: 1},
      {sku: 'B', digital: false, qty: 2},
    ]);
  });

  it('nets out a refunded return (amount and units)', () => {
    const r = refundableOf({...money0, totalCents: 20000, items: lines}, [{status: 'Refunded', items: [{lineId: 2, qty: 1}]}]);
    expect(r.amount).toBe(150);
    expect(r.remaining[1]!.qty).toBe(1);
    // A return that is not refunded does not count.
    expect(refundableOf({...money0, totalCents: 20000, items: lines}, [{status: 'Approved', items: [{lineId: 2, qty: 1}]}]).amount).toBe(200);
  });

  it('exclusive tax adds the line tax share; inclusive does not', () => {
    const exclusive = {subtotalCents: 20000, discountCents: 0, taxCents: 2000, pricesIncludeTax: false, taxRate: null, items: lines};
    expect(returnAmount(exclusive, [{lineId: 1, qty: 1, reason: ''}])).toBe(110);
    const inclusive = {...exclusive, pricesIncludeTax: true};
    expect(returnAmount(inclusive, [{lineId: 1, qty: 1, reason: ''}])).toBe(100);
    // Removed line → nothing.
    expect(returnAmount(inclusive, [{lineId: 99, qty: 1, reason: ''}])).toBe(0);
  });

  it('a return completes the order only when every physical line is back; shipping then refunded', () => {
    const order = {...money0, shippingCents: 1000, items: [...lines, {id: 3, priceCents: 900, qty: 1, discountCents: 0, sku: 'D', digital: true}]};
    const settings = {refundShipping: true, taxShipping: false, taxRate: 0};
    const partial = returnRefundPlan(order, [{lineId: 1, qty: 1, reason: ''}], [], settings);
    expect(partial.allReturned).toBe(false);
    expect(partial.asked).toBe(100);
    const complete = returnRefundPlan(order, [{lineId: 2, qty: 2, reason: ''}], [{items: [{lineId: 1, qty: 1}]}], settings);
    expect(complete.allReturned).toBe(true);
    expect(complete.asked).toBe(110);
    expect(complete.restock).toEqual([{sku: 'B', qty: 2, digital: false}]);
    expect(returnRefundPlan(order, [{lineId: 2, qty: 2, reason: ''}], [{items: [{lineId: 1, qty: 1}]}], {...settings, refundShipping: false}).asked).toBe(100);
  });
});

describe('events', () => {
  it('shipping with tracking writes one event', () => {
    const plan = orderUpdatePlan(base, {fulfillment: 'Shipped', carrier: 'DHL Express', tracking: 'JJD1'});
    expect(plan.events).toEqual([{kind: 'status', message: 'Marked as shipped · DHL Express JJD1'}]);
    expect(plan.data).toMatchObject({fulfillment: 'Shipped', stage: 3, carrier: 'DHL Express', tracking: 'JJD1'});
  });

  it('tracking edits and removal', () => {
    const shipped = {...base, fulfillment: 'Shipped', stage: 3, carrier: 'DHL', tracking: 'X'};
    expect(orderUpdatePlan(shipped, {tracking: 'Y'}).events).toEqual([{kind: 'tracking', message: 'Tracking updated · DHL Y'}]);
    expect(orderUpdatePlan(shipped, {carrier: null, tracking: null}).events).toEqual([{kind: 'tracking', message: 'Tracking removed'}]);
  });

  it('stage-only change, payment and no-op', () => {
    expect(orderUpdatePlan(base, {stage: 2}).events[0]!.message).toBe('Progress set to step 2 of 4');
    expect(orderUpdatePlan(base, {payment: 'Refunded'}).events[0]).toEqual({kind: 'refund', message: 'Payment marked as refunded'});
    expect(orderUpdatePlan(base, {fulfillment: 'Unfulfilled', note: null}).events).toEqual([]);
  });

  it('refuses fulfilment moves on cancelled or refunded orders', () => {
    expect(() => orderUpdatePlan({...base, fulfillment: 'Cancelled'}, {fulfillment: 'Processing'})).toThrow(/cancelled/);
    expect(() => orderUpdatePlan({...base, payment: 'Refunded'}, {fulfillment: 'Processing'})).toThrow(/refunded/);
    // Tracking stays editable on a refunded order.
    expect(orderUpdatePlan({...base, payment: 'Refunded', fulfillment: 'Shipped'}, {tracking: 'Z'}).events).toHaveLength(1);
  });

  it('note preview is cut at 140 characters; messages clipped at 2000', () => {
    const long = 'n'.repeat(300);
    const msg = orderUpdatePlan(base, {note: long}).events[0]!.message;
    expect(msg).toBe(`Note · ${'n'.repeat(139)}…`);
    expect(orderUpdatePlan({...base, note: 'x'}, {note: null}).events[0]!.message).toBe('Note cleared');
    expect(clip('a'.repeat(2100), 2000)).toHaveLength(2000);
    expect(returnEventMessage('Approved', 'b'.repeat(2500))).toHaveLength(2000);
  });

  it('refund messages start with the amount', () => {
    expect(refundMessage(14800, 'USD', true, 3, 'Damaged')).toBe('Refunded $148 · 3 items restocked · Damaged');
    expect(refundMessage(14850, 'USD', true, 0)).toBe('Refunded $148.50 · nothing to restock');
    expect(returnRefundMessage(5000, 'USD', 1, true)).toBe('Return refunded $50 · 1 item restocked · order marked refunded');
  });

  it('actor name falls back to email, clipped to 120', () => {
    expect(actorName({name: '  ', email: 'a@example.test'})).toBe('a@example.test');
    expect(actorName({name: 'x'.repeat(200), email: 'a@example.test'})).toHaveLength(120);
  });
});

describe('inputs', () => {
  it('search keeps at most 5 words', () => {
    expect(searchWords(' a  b c d e f g ')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('dates: bare day or ISO; garbage refused', () => {
    expect(dateParam.safeParse('2026-10-01').data).toMatchObject({bare: true});
    expect(dateParam.safeParse('2026-10-01T10:00:00Z').data).toMatchObject({bare: false});
    expect(dateParam.safeParse('nope').success).toBe(false);
  });

  it('return ids are small positive integers', () => {
    expect(returnIdOf('12')).toBe(12);
    expect(returnIdOf('0')).toBeNull();
    expect(returnIdOf('1234567890')).toBeNull();
    expect(returnIdOf('abc')).toBeNull();
  });

  it('email money drops whole-number decimals', () => {
    expect(emailMoney(148, 'USD')).toBe('$148');
    expect(emailMoney(24.6, 'EUR')).toBe('€24.60');
  });
});

describe('CSV', () => {
  const row = {
    id: 1,
    number: 'VRL-24817',
    placedAt: new Date('2026-10-01T10:00:00Z'),
    email: 'ann@example.test',
    userId: null,
    payment: 'Paid',
    fulfillment: 'Shipped',
    totalCents: 15850,
    currency: 'USD',
    address: {name: '=HYPERLINK("x")', country: 'DK'},
    user: null,
    items: [{qty: 2}, {qty: 1}],
    subtotalCents: 15000,
    discountCode: null,
    discountCents: 0,
    shippingCents: 850,
    taxCents: 0,
    method: 'Express',
    carrier: 'DHL',
    tracking: '+123',
  };

  it('server: header order, money, formula escaping', () => {
    expect(ORDERS_CSV_HEADER.join(',')).toBe(
      'Order,Placed,Customer,Email,Payment,Fulfillment,Items,Subtotal,Discount code,Discount,Shipping,Tax,Total,Country,Method,Carrier,Tracking'
    );
    const line = orderCsvRow(row as never);
    expect(line).toBe(
      `VRL-24817,2026-10-01T10:00:00.000Z,"'=HYPERLINK(""x"")",ann@example.test,Paid,Shipped,3,150.00,,0.00,8.50,0.00,158.50,DK,Express,DHL,'+123`
    );
  });

  it('client: selected rows, escaped the same way', () => {
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-5)).toBe('-5');
    const text = csvText(
      selectedCsvRows([
        {
          number: 'VRL-1',
          placedAt: '2026-10-01T10:00:00.000Z',
          date: '1 Oct 2026',
          customerName: '-Ann',
          email: 'a@example.test',
          customerId: null,
          payment: 'Paid',
          fulfillment: 'Unfulfilled',
          total: 12.5,
          count: 2,
        },
      ])
    );
    expect(text).toBe(
      "Order,Placed,Customer,Email,Payment,Fulfilment,Items,Total\r\nVRL-1,2026-10-01T10:00:00.000Z,'-Ann,a@example.test,Paid,Unfulfilled,2,12.50\r\n"
    );
  });
});

describe('portal search', () => {
  it('drops bad values and the old page param', () => {
    expect(validateOrdersSearch({q: 'ann', payment: 'Paid,Nope', fulfillment: 'Shipped', from: '2026-10-01', to: 'bad', sort: '-total', page: '3'})).toEqual({
      q: 'ann',
      payment: ['Paid'],
      fulfillment: ['Shipped'],
      from: '2026-10-01',
      sort: '-total',
    });
    expect(validateReturnsSearch({status: 'Requested,Weird', page: '2'})).toEqual({status: ['Requested']});
  });

  it('sends local-day bounds as ISO', () => {
    const q = ordersQuery({from: '2026-10-01', to: '2026-10-02'});
    expect(q.from).toBe(new Date('2026-10-01T00:00:00').toISOString());
    expect(q.to).toBe(new Date('2026-10-02T23:59:59.999').toISOString());
    expect(ordersQuery({}).from).toBeUndefined();
  });
});
