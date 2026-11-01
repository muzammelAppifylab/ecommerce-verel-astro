import {describe, expect, it} from 'vitest';

import {cardBrand, expiryInFuture, luhn, simulateCharge, validateCard} from '../src/server/lib/payments/simulated';

/** WP-11: the simulated provider (VAREL worker/lib/payments/simulated.ts, verbatim). */
describe('simulated card payments', () => {
  it('checks the Luhn digit and the length', () => {
    expect(luhn('4242424242424242')).toBe(true);
    expect(luhn('4242424242424241')).toBe(false);
    expect(luhn('42424242424')).toBe(false); // 11 digits
    expect(luhn('4'.repeat(20))).toBe(false);
    expect(luhn('4242-4242-4242-4242')).toBe(false); // digits only (callers strip separators)
  });

  it('names the brand', () => {
    expect(cardBrand('4242424242424242')).toBe('Visa');
    expect(cardBrand('5105105105105100')).toBe('Mastercard');
    expect(cardBrand('2223003122003222')).toBe('Mastercard');
    expect(cardBrand('378282246310005')).toBe('American Express');
    expect(cardBrand('340000000000009')).toBe('American Express');
    expect(cardBrand('6011111111111117')).toBe('Discover');
    expect(cardBrand('6500000000000002')).toBe('Discover');
    expect(cardBrand('6445644564456445')).toBe('Discover');
    expect(cardBrand('3530111333300000')).toBe('Card');
  });

  it('reads MM/YY and MM/YYYY, valid through the end of the month', () => {
    const now = new Date(Date.UTC(2026, 10, 30, 23, 59)); // 30 Nov 2026
    expect(expiryInFuture('11/26', now)).toBe(true);
    expect(expiryInFuture('11/2026', now)).toBe(true);
    expect(expiryInFuture('10/26', now)).toBe(false);
    expect(expiryInFuture(' 1 / 30 ', now)).toBe(true);
    expect(expiryInFuture('00/30', now)).toBe(false);
    expect(expiryInFuture('13/30', now)).toBe(false);
    expect(expiryInFuture('1130', now)).toBe(false);
    expect(expiryInFuture('11/26', new Date(Date.UTC(2026, 11, 1)))).toBe(false);
  });

  it('keys field errors like the request body', () => {
    expect(validateCard({name: ' ', number: '', expiry: '', cvc: '1'})).toEqual({
      'payment.name': 'Enter the name on the card',
      'payment.number': 'Enter your card number',
      'payment.expiry': 'Enter the expiry date',
      'payment.cvc': 'Enter the 3 or 4 digit security code',
    });
    expect(validateCard({name: 'A', number: '4242 4242 4242 4241', expiry: '01/20', cvc: '123'})).toEqual({
      'payment.number': 'Check the card number',
      'payment.expiry': 'Use a card that has not expired (MM/YY)',
    });
  });

  it('charges a good card and keeps only brand and last 4', () => {
    expect(simulateCharge({name: 'Ada', number: '4242 4242-4242 4242', expiry: '12/99', cvc: '123'})).toEqual({
      ok: true,
      brand: 'Visa',
      last4: '4242',
    });
  });

  it('asks for a card, checks it, and declines the test card', () => {
    expect(simulateCharge(undefined)).toMatchObject({ok: false, status: 422, fields: {payment: 'Enter your card details'}});
    expect(simulateCharge({name: '', number: '1', expiry: 'x', cvc: ''})).toMatchObject({ok: false, status: 422, message: 'Check your card details'});
    expect(simulateCharge({name: 'Ada', number: '4000 0000 0000 0002', expiry: '12/99', cvc: '123'})).toEqual({
      ok: false,
      status: 402,
      code: 'PAYMENT_DECLINED',
      message: 'Your card was declined. Try another card or contact your bank',
    });
  });
});
