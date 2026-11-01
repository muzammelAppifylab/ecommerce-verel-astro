import {describe, expect, it} from 'vitest';

import {
  appliedDiscounts,
  codeApplies,
  CUSTOMER_DISCOUNT_ERRORS,
  discountDescriptor,
  isDiscountError,
  lineDiscountNote,
  merchandiseDiscounts,
  NOTICE_DISCOUNT_ERRORS,
  shippingDiscount,
} from '../src/components/cart/discounts';
import {lineMeta} from '../src/components/cart/ui';
import type {AppliedDiscountSummary, Cart} from '../src/lib/types/cart';

/** Bag display helpers (WP-09, port of VAREL src/pages/checkout/discounts.tsx + OrderSummary lineMeta). */

const d = (over: Partial<AppliedDiscountSummary>): AppliedDiscountSummary => ({
  id: '1',
  label: 'STUDIO10 · 10% off',
  code: 'STUDIO10',
  automatic: false,
  amount: 10,
  freeShipping: false,
  ...over,
});

const bag = (discountCode: string | null, totals: Partial<Cart['totals']>) =>
  ({discountCode, totals: {discount: 0, discountCode: null, discounts: [], ...totals}}) as unknown as Pick<Cart, 'discountCode' | 'totals'>;

describe('cart discount helpers', () => {
  it('codeApplies compares case-insensitively and falls back to totals.discountCode', () => {
    expect(codeApplies(bag('studio10', {discounts: [d({})]}))).toBe(true);
    expect(codeApplies(bag('OTHER', {discounts: [d({})]}))).toBe(false);
    expect(codeApplies(bag(null, {discounts: [d({})]}))).toBe(false);
    expect(codeApplies(bag('STUDIO10', {discounts: undefined, discountCode: 'Studio10'}))).toBe(true);
  });

  it('appliedDiscounts falls back to one synthetic row', () => {
    expect(appliedDiscounts({discount: 5, discountCode: 'X'})).toEqual([
      {id: 'legacy', label: 'X', code: 'X', automatic: false, amount: 5, freeShipping: false},
    ]);
    expect(appliedDiscounts({discount: 5, discountCode: null})[0]!.label).toBe('Discount');
    expect(appliedDiscounts({discount: 0, discountCode: null})).toEqual([]);
    const list = [d({})];
    expect(appliedDiscounts({discount: 10, discountCode: 'STUDIO10', discounts: list})).toBe(list);
  });

  it('splits merchandise and free-shipping discounts', () => {
    const ship = d({id: '2', code: 'FREESHIP', label: 'FREESHIP · Free shipping', amount: 0, freeShipping: true});
    const list = [d({}), ship];
    expect(merchandiseDiscounts(list)).toEqual([list[0]]);
    expect(shippingDiscount(list)).toBe(ship);
    expect(shippingDiscount([d({})])).toBeNull();
  });

  it('describes a discount without its code', () => {
    expect(discountDescriptor(d({}))).toBe('10% off');
    expect(discountDescriptor(d({code: null, label: 'Autumn knitwear · 15% off'}))).toBe('Autumn knitwear · 15% off');
    expect(discountDescriptor(d({label: 'STUDIO10'}))).toBe('STUDIO10');
  });

  it('notes a line discount: the one offer, free units, or the amount', () => {
    expect(lineDiscountNote({discount: 5, unit: 50, qty: 1}, [d({})])).toBe('10% off');
    const two = [d({}), d({id: '2', code: null, label: 'Bundle', amount: 3})];
    expect(lineDiscountNote({discount: 50, unit: 50, qty: 2}, two)).toMatch(/^1 free · −/);
    expect(lineDiscountNote({discount: 7, unit: 50, qty: 2}, two)).toMatch(/^−/);
  });

  it('error sets match lower-case wire codes and upper-case engine codes', () => {
    expect(isDiscountError(NOTICE_DISCOUNT_ERRORS, 'discount_minimum')).toBe(true);
    expect(isDiscountError(NOTICE_DISCOUNT_ERRORS, 'DISCOUNT_MIN_QTY')).toBe(true);
    expect(isDiscountError(NOTICE_DISCOUNT_ERRORS, 'discount_invalid')).toBe(false);
    expect(isDiscountError(CUSTOMER_DISCOUNT_ERRORS, 'discount_expired')).toBe(true);
    expect(isDiscountError(CUSTOMER_DISCOUNT_ERRORS, null)).toBe(false);
  });

  it('lineMeta joins colour, size, options and quantity', () => {
    expect(lineMeta({color: 'Stone', size: 'M', qty: 1})).toBe('Stone · M · Qty 1');
    expect(lineMeta({color: 'Stone', colorLabel: 'Sten', size: null, qty: 2, options: {Fabric: 'Cork'}})).toBe('Sten · Cork · Qty 2');
  });
});
