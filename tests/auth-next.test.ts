import {describe, expect, it} from 'vitest';

import {AUTH_FALLBACK, safeAuthNext, withNext} from '../src/components/auth/next';

/** Where the sign-in pages send the visitor afterwards (VAREL `safeNext` + the template's `nextPath`). */
describe('safeAuthNext', () => {
  it('falls back to the customer account', () => {
    expect(AUTH_FALLBACK).toBe('/account/');
    expect(safeAuthNext(null)).toBe('/account/');
    expect(safeAuthNext('')).toBe('/account/');
  });

  it('keeps same-site paths', () => {
    expect(safeAuthNext('/checkout/')).toBe('/checkout/');
    expect(safeAuthNext('/da/account/orders/?status=open')).toBe('/da/account/orders/?status=open');
    expect(safeAuthNext('/product/linen-shirt/#reviews')).toBe('/product/linen-shirt/#reviews');
  });

  it('refuses other sites and odd paths', () => {
    const bads = [
      '//evil.example',
      '/\\evil.example',
      'https://x.example/',
      'javascript:alert(1)',
      'account/',
      `/${'a'.repeat(512)}`,
      '/a\u0000b',
      '/a\nb',
      '/a\\b',
    ];
    for (const bad of bads)
      expect(safeAuthNext(bad), bad).toBe('/account/');
  });

  it('never goes back to a sign-in page (VAREL)', () => {
    for (const page of ['/account/login/', '/account/login', '/da/account/register/?next=/x', '/account/reset/', '/account/forgot', '/sv/account/verify/', '/account/confirm-email/?a=1'])
      expect(safeAuthNext(page), page).toBe('/account/');
    // …but the account app is fine.
    expect(safeAuthNext('/account/orders/')).toBe('/account/orders/');
    expect(safeAuthNext('/account/logins-history/')).toBe('/account/logins-history/');
  });
});

describe('withNext', () => {
  it('adds ?next= only when it is not the fallback', () => {
    expect(withNext('/account/register/', '/account/')).toBe('/account/register/');
    expect(withNext('/account/register/', '/checkout/')).toBe('/account/register/?next=%2Fcheckout%2F');
  });
});
