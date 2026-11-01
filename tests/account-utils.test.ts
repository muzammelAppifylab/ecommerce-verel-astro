import {describe, expect, it} from 'vitest';

import {inAppPath, isAccountPath, sectionOf} from '../src/account/paths';

import {addressProblems, deleteProblems, emailProblems, firstProblem, passwordProblems, profileProblems} from '../src/account/rules';
import {
  accountLinks,
  addressBlock,
  addressLines,
  downloadHref,
  isPlatformFileId,
  itemMeta,
  orderUnits,
  payTextClass,
  statusTextClass,
} from '../src/account/ui/orderUtils';
import {makeT} from '../src/lib/i18n/core';

const address = {name: 'Mira Halvorsen', line1: '112 Studio', line2: null, zip: '2200', city: 'Copenhagen', country: 'Germany'};

describe('account presentation helpers (VAREL orderUtils)', () => {
  it('address block and lines drop empty parts and localise the country', () => {
    expect(addressBlock(address)).toBe('Mira Halvorsen, 112 Studio, 2200 Copenhagen, Germany');
    expect(addressLines(address)).toEqual(['Mira Halvorsen', '112 Studio', '2200 Copenhagen', 'Germany']);
    expect(addressLines(address, 'de').at(-1)).toBe('Deutschland');
    expect(addressBlock({...address, line2: 'Apt 4'})).toContain('112 Studio, Apt 4, 2200');
  });

  it('item meta joins colour, size, options and the quantity', () => {
    const t = makeT({locale: 'en', catalogs: {checkout: {qty: 'Qty {{qty}}'}}}, 'account');
    expect(itemMeta(t, {color: 'Camel', size: 'M', qty: 2, options: {Monogram: 'MH'}})).toBe('Camel · M · MH · Qty 2');
    expect(itemMeta(t, {color: null, size: null, qty: 1})).toBe('Qty 1');
  });

  it('order units prefer count', () => {
    const items = [{qty: 2}, {qty: 3}] as never;
    expect(orderUnits({items, count: 9} as never)).toBe(9);
    expect(orderUnits({items} as never)).toBe(5);
  });

  it('download links', () => {
    expect(downloadHref('file_0123456789abcdefghijklmnop')).toBe('/site-api/downloads/file_0123456789abcdefghijklmnop');
    expect(downloadHref('a b.pdf', {order: 'VRL-24817', email: 'a@b.dk'})).toBe(
      '/site-api/downloads/a%20b.pdf?order=VRL-24817&email=a%40b.dk'
    );
    expect(downloadHref('https://cdn.example/x.pdf')).toBe('https://cdn.example/x.pdf');
    expect(downloadHref('/files/x.pdf')).toBe('/files/x.pdf');
    expect(isPlatformFileId('file_0123456789abcdefghijklmnop')).toBe(true);
    expect(isPlatformFileId('varel-care-guide.pdf')).toBe(false);
  });

  it('status colour maps', () => {
    expect(payTextClass('Paid')).toBe('text-signal-positive');
    expect(payTextClass('Refunded')).toBe('text-signal-critical');
    expect(payTextClass('Pending')).toBe('text-signal-notice');
    expect(statusTextClass('Delivered')).toBe('text-signal-positive');
    expect(statusTextClass('Shipped')).toBe('text-signal-notice');
    expect(statusTextClass('Cancelled')).toBe('text-signal-critical');
    expect(statusTextClass('Unfulfilled')).toBe('text-ink-400');
  });

  it('account links keep the language; sign-in pages never get a prefix', () => {
    const da = accountLinks('da');
    expect(da.account).toBe('/da/account/');
    expect(da.order('VRL-1')).toBe('/da/account/orders/VRL-1/');
    expect(da.wishlist).toBe('/da/wishlist/');
    expect(da.returns('VRL-1')).toBe('/da/returns/?order=VRL-1');
    expect(da.forgot).toBe('/account/forgot/');
    expect(accountLinks('en').account).toBe('/account/');
  });
});

describe('account app paths', () => {
  it('serves the account screens only', () => {
    for (const ok of ['', 'orders', 'orders/', 'orders/VRL-24817/', 'details/', 'addresses/', 'downloads/', 'privacy/']) {
      expect(isAccountPath(ok)).toBe(true);
    }
    for (const bad of ['nope/', 'details/x/', 'orders/a/b/', 'login/x', `orders/${'x'.repeat(41)}/`]) {
      expect(isAccountPath(bad)).toBe(false);
    }
  });

  it('section and path inside the basepath', () => {
    expect(inAppPath('/da/account/orders/VRL-1/', '/da/account')).toBe('/orders/VRL-1/');
    expect(inAppPath('/account/', '/account')).toBe('/');
    expect(sectionOf('/orders/VRL-1/')).toBe('orders');
    expect(sectionOf('/')).toBe('overview');
    expect(sectionOf('/wishlist/')).toBe('overview');
  });
});

describe('account form rules mirror the server', () => {
  it('profile', () => {
    expect(profileProblems({firstName: ' ', lastName: '', phone: ''})).toEqual({
      firstName: 'profile.errors.firstName',
      lastName: 'profile.errors.lastName',
    });
    expect(profileProblems({firstName: 'x'.repeat(81), lastName: 'Ok', phone: '1'.repeat(41)})).toEqual({
      firstName: 'profile.errors.firstNameLong',
      phone: 'profile.errors.phoneLong',
    });
  });

  it('password: 10–128, not the email name, confirmed', () => {
    const base = {currentPassword: 'old', newPassword: 'a long new phrase', confirm: 'a long new phrase'};
    expect(passwordProblems(base, 'mira@example.com')).toEqual({});
    expect(passwordProblems({...base, currentPassword: ''})).toEqual({currentPassword: 'password.errors.current'});
    expect(passwordProblems({...base, newPassword: 'short', confirm: 'short'}).newPassword).toBe('password.errors.length');
    expect(passwordProblems({...base, newPassword: 'x'.repeat(129)}).newPassword).toBe('password.errors.tooLong');
    expect(passwordProblems({...base, newPassword: 'hello mira123', confirm: 'hello mira123'}, 'mira@example.com').newPassword).toBe(
      'password.errors.email'
    );
    expect(passwordProblems({...base, confirm: 'other'}).confirm).toBe('password.errors.match');
  });

  it('email change', () => {
    expect(emailProblems({email: 'new@example.com', password: 'x'}, 'old@example.com', true)).toEqual({});
    expect(emailProblems({email: 'nope', password: ''}, 'old@example.com', true)).toEqual({
      email: 'email.errors.email',
      password: 'email.errors.password',
    });
    expect(emailProblems({email: 'OLD@example.com', password: ''}, 'old@example.com', false)).toEqual({email: 'email.errors.same'});
  });

  it('addresses', () => {
    const ok = {label: '', name: 'A', line1: 'B', line2: '', zip: '1', city: 'C', country: 'Denmark', phone: ''};
    expect(addressProblems(ok)).toEqual({});
    expect(addressProblems({...ok, name: '', city: 'x'.repeat(101)})).toEqual({
      name: 'dialog.errors.name',
      city: 'dialog.errors.tooLong',
    });
    expect(firstProblem(['label', 'name', 'city'] as const, {city: 'x', name: 'y'})).toBe('name');
  });

  it('delete: DELETE in capitals, the password when there is one', () => {
    expect(deleteProblems({password: '', confirm: 'delete'}, true)).toEqual({
      password: 'privacy.delete.enterPassword',
      confirm: 'privacy.delete.errors.confirm',
    });
    expect(deleteProblems({password: '', confirm: ' DELETE '}, false)).toEqual({});
  });
});
