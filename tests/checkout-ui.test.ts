/* WP-12: the checkout UI's pure helpers (card, address, discounts, form errors, countries, Stripe amounts,
   Danish postcodes, confirmation links). The server re-validates everything; these mirror its rules. */
import {describe, expect, it} from 'vitest';

import {EMPTY_ADDRESS, toAddressState, toApiAddress, validateAddress} from '../src/components/checkout/address';
import {expiryValid, formatCardNumber, formatCvc, formatExpiry, luhn, validateCard} from '../src/components/checkout/card';
import {downloadHref, safeTrackingUrl} from '../src/components/checkout/ConfirmationBody';
import {countryName, countryOptions} from '../src/components/checkout/countries';
import {
  appliedDiscounts,
  codeApplies,
  CUSTOMER_DISCOUNT_ERRORS,
  discountDescriptor,
  isCustomerDiscountError,
  isNoticeDiscountError,
  lineDiscountNote,
  merchandiseDiscounts,
  NOTICE_DISCOUNT_ERRORS,
  shippingDiscount,
} from '../src/components/checkout/discounts';
import {dkTown} from '../src/components/checkout/dkPostcodes';
import {errorCount, hasErrors, mapApiFields, NO_ERRORS} from '../src/components/checkout/form-errors';
import {toMinor} from '../src/components/checkout/stripe-amount';
import type {AppliedDiscountSummary} from '../src/lib/types/cart';

// A translator that shows which key (and vars) it was asked for.
const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

describe('card', () => {
  it('formats the number in groups of four, at most 19 digits', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('4242-4242')).toBe('4242 4242');
    expect(formatCardNumber('1'.repeat(25)).replace(/ /g, '')).toHaveLength(19);
  });
  it('formats expiry and CVC', () => {
    expect(formatExpiry('9')).toBe('09');
    expect(formatExpiry('0929')).toBe('09 / 29');
    expect(formatExpiry('1')).toBe('1');
    expect(formatCvc('12a345')).toBe('1234');
  });
  it('checks Luhn within 12–19 digits', () => {
    expect(luhn('4242 4242 4242 4242')).toBe(true);
    expect(luhn('4242 4242 4242 4241')).toBe(false);
    expect(luhn('42424')).toBe(false);
    expect(luhn('4'.repeat(20))).toBe(false);
  });
  it('rejects past and impossible expiry dates', () => {
    const now = new Date(2026, 10, 1);
    expect(expiryValid('12 / 26', now)).toBe(true);
    expect(expiryValid('10 / 26', now)).toBe(false);
    expect(expiryValid('13 / 30', now)).toBe(false);
    expect(expiryValid('1230', now)).toBe(false);
  });
  it('validateCard maps to checkout.errors.*', () => {
    const now = new Date(2026, 10, 1);
    expect(validateCard({name: '', number: '', expiry: '', cvc: ''}, t, now)).toEqual({
      name: 'errors.cardName',
      number: 'errors.cardNumber',
      expiry: 'errors.expiry',
      cvc: 'errors.cvc',
    });
    expect(validateCard({name: 'A', number: '4242 4242 4242 4241', expiry: '01 / 20', cvc: '123'}, t, now)).toEqual({
      number: 'errors.cardCheck',
      expiry: 'errors.expiryPast',
    });
    expect(validateCard({name: 'A', number: '4242 4242 4242 4242', expiry: '09 / 29', cvc: '123'}, t, now)).toEqual({});
  });
});

describe('address', () => {
  const dk = {...EMPTY_ADDRESS, name: 'Ada Lovelace', country: 'Denmark', line1: 'Vesterbrogade 1', city: 'København', zip: '2100'};
  it('accepts a valid Danish address and rejects a bad postcode', () => {
    expect(validateAddress(dk, t)).toEqual({});
    expect(validateAddress({...dk, zip: '21'}, t).zip).toMatch(/^errors\.zipFormat/);
    expect(validateAddress({...dk, line1: 'Vesterbrogade'}, t).line1).toBe('errors.line1Number');
    expect(validateAddress({...dk, name: '12'}, t).name).toBe('errors.name');
  });
  it('requires a US state', () => {
    const us = {...EMPTY_ADDRESS, name: 'Ada', country: 'United States', line1: '1 Main St', city: 'Austin', zip: '78701'};
    expect(validateAddress(us, t).region).toBe('errors.region.state');
    expect(validateAddress({...us, region: 'TX'}, t)).toEqual({});
  });
  it('checks UK postcodes', () => {
    const gb = {...EMPTY_ADDRESS, name: 'Ada', country: 'United Kingdom', line1: '10 Downing Street', city: 'London', zip: 'SW1A 2AA'};
    expect(validateAddress(gb, t)).toEqual({});
    expect(validateAddress({...gb, zip: '12345'}, t).zip).toMatch(/^errors\.zipFormat/);
  });
  it('toApiAddress sends region only where the format has one and normalises the zip', () => {
    expect(toApiAddress({...dk, region: 'X', zip: ' dk-2100 '})).toEqual({
      name: 'Ada Lovelace',
      line1: 'Vesterbrogade 1',
      city: 'København',
      zip: '2100',
      country: 'Denmark',
    });
    const us = toApiAddress({...EMPTY_ADDRESS, name: 'A', country: 'United States', line1: '1 Main', line2: ' Apt 2 ', city: 'Austin', region: 'TX', zip: '78701'});
    expect(us.region).toBe('TX');
    expect(us.line2).toBe('Apt 2');
  });
  it('toAddressState splits "Austin, TX" unless a region is saved', () => {
    const a = {name: 'A', country: 'United States', line1: '1 Main', city: 'Austin, TX', zip: '78701'};
    expect(toAddressState(a)).toMatchObject({city: 'Austin', region: 'TX'});
    expect(toAddressState({...a, city: 'Austin', region: 'TX'})).toMatchObject({city: 'Austin', region: 'TX'});
    expect(toAddressState({...a, country: 'Denmark', city: 'Aarhus, C'})).toMatchObject({city: 'Aarhus, C', region: ''});
  });
});

describe('discounts', () => {
  const pct: AppliedDiscountSummary = {id: '1', label: 'STUDIO10 · 10% off', code: 'STUDIO10', automatic: false, amount: 12, freeShipping: false};
  const ship: AppliedDiscountSummary = {id: '2', label: 'Free shipping weekend', code: null, automatic: true, amount: 0, freeShipping: true};
  const money = {minus: (n: number) => `−$${n.toFixed(2)}`};

  it('error-code sets are lower case and checks are case-insensitive', () => {
    for (const c of [...CUSTOMER_DISCOUNT_ERRORS, ...NOTICE_DISCOUNT_ERRORS]) expect(c).toBe(c.toLowerCase());
    expect(isCustomerDiscountError('DISCOUNT_CUSTOMER_LIMIT')).toBe(true);
    expect(isCustomerDiscountError('discount_minimum')).toBe(false);
    expect(isNoticeDiscountError('DISCOUNT_MIN_QTY')).toBe(true);
    expect(isCustomerDiscountError(null)).toBe(false);
  });
  it('codeApplies reads the list, then the legacy field', () => {
    const totals = {discounts: [pct], discountCode: null} as never;
    expect(codeApplies({discountCode: 'studio10', totals})).toBe(true);
    expect(codeApplies({discountCode: 'OTHER', totals})).toBe(false);
    expect(codeApplies({discountCode: 'X', totals: {discountCode: 'x'} as never})).toBe(true);
    expect(codeApplies({discountCode: null, totals})).toBe(false);
  });
  it('appliedDiscounts falls back to one synthetic row', () => {
    expect(appliedDiscounts({discount: 5, discountCode: null}, t)).toEqual([
      {id: 'legacy', label: 'discount.fallback', code: null, automatic: true, amount: 5, freeShipping: false},
    ]);
    expect(appliedDiscounts({discount: 0, discountCode: null})).toEqual([]);
    expect(appliedDiscounts({discount: 5, discountCode: 'A', discounts: [pct]})).toEqual([pct]);
  });
  it('splits merchandise and shipping discounts', () => {
    expect(merchandiseDiscounts([pct, ship])).toEqual([pct]);
    expect(shippingDiscount([pct, ship])).toBe(ship);
    expect(shippingDiscount([pct])).toBeNull();
  });
  it('describes discounts and line notes', () => {
    expect(discountDescriptor(pct)).toBe('10% off');
    expect(discountDescriptor(ship)).toBe('Free shipping weekend');
    expect(lineDiscountNote({discount: 3, unit: 30, qty: 1}, [pct], t, money)).toBe('10% off');
    const two = [pct, {...pct, id: '3', label: 'Bundle', code: null, amount: 60}];
    expect(lineDiscountNote({discount: 60, unit: 30, qty: 3}, two, t, money)).toBe('discount.lineFree {"count":2,"amount":"−$60.00"}');
    expect(lineDiscountNote({discount: 7.5, unit: 30, qty: 3}, two, t, money)).toBe('−$7.50');
  });
});

describe('form errors', () => {
  it('maps every API field family', () => {
    const e = mapApiFields({
      email: 'e',
      phone: 'p',
      shippingMethodId: 'm',
      customerNote: 'n',
      acceptTerms: 't',
      'shippingAddress.city': 'sc',
      'billingAddress.zip': 'bz',
      'payment.number': 'pn',
      somethingElse: 'f',
    });
    expect(e).toEqual({
      email: 'e',
      phone: 'p',
      method: 'm',
      note: 'n',
      terms: 't',
      shipping: {city: 'sc'},
      billing: {zip: 'bz'},
      card: {number: 'pn'},
      form: 'f',
    });
    expect(errorCount(e)).toBe(8);
    expect(hasErrors(e)).toBe(true);
    expect(hasErrors(NO_ERRORS)).toBe(false);
    expect(hasErrors({...NO_ERRORS, form: 'x'})).toBe(true);
    expect(errorCount({...NO_ERRORS, form: 'x'})).toBe(0);
  });
  it('an address key without a field is a form error', () => {
    expect(mapApiFields({shippingAddress: 'bad'}).form).toBe('bad');
  });
});

describe('countries', () => {
  it('localises names, English and unknown names pass through', () => {
    expect(countryName('Germany', 'en')).toBe('Germany');
    expect(countryName('Germany', 'de')).toBe('Deutschland');
    expect(countryName('Atlantis', 'de')).toBe('Atlantis');
  });
  it('keeps the home country first and sorts the rest in the shopper language', () => {
    const opts = countryOptions(['Denmark', 'Sweden', 'Germany', 'Austria'], 'de');
    expect(opts[0]).toEqual({value: 'Denmark', label: 'Dänemark'});
    expect(opts.slice(1).map(o => o.value)).toEqual(['Germany', 'Austria', 'Sweden']);
    expect(countryOptions(['Denmark', 'Sweden', 'Germany'], 'en').map(o => o.value)).toEqual(['Denmark', 'Sweden', 'Germany']);
  });
});

describe('Stripe amounts', () => {
  it('converts to the minor unit', () => {
    expect(toMinor(148.5, 'usd')).toBe(14850);
    expect(toMinor(1500, 'JPY')).toBe(1500);
    expect(toMinor(1.234, 'KWD')).toBe(1230);
  });
});

describe('Danish postcodes', () => {
  it('finds towns, bare codes inherit, unknown is null', () => {
    expect(dkTown('2100')).toBe('København Ø');
    expect(dkTown('1002')).toBe('København K');
    expect(dkTown('0001')).toBeNull();
  });
});

describe('confirmation links', () => {
  it('builds the guarded download URL', () => {
    expect(downloadHref('pattern.pdf', 'VRL-1', 'a@b.co')).toBe('/site-api/downloads/pattern.pdf?order=VRL-1&email=a%40b.co');
    expect(downloadHref('pattern.pdf', 'VRL-1')).toBe('/site-api/downloads/pattern.pdf');
    expect(downloadHref('https://x.test/f.pdf', 'VRL-1', 'a@b.co')).toBe('https://x.test/f.pdf');
  });
  it('keeps only https tracking links', () => {
    expect(safeTrackingUrl('https://track.example/1')).toBe('https://track.example/1');
    expect(safeTrackingUrl('javascript:alert(1)')).toBeNull();
    expect(safeTrackingUrl('http://track.example/1')).toBeNull();
    expect(safeTrackingUrl(null)).toBeNull();
  });
});
