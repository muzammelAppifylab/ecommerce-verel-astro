/* F2: the storefront shell's pure helpers (locale-aware links, word catalogs, money formatting). */
import {describe, expect, it} from 'vitest';

import {isActivePath, localizeHref, stripLocale} from '../src/components/varel/href';
import {money, priceText, setMoneyContext} from '../src/components/varel/support';
import {interpolate, mergeDicts, translate} from '../src/components/varel/text';
import {EN_FALLBACK} from '../src/components/varel/text-en';

describe('localizeHref', () => {
  it('keeps English unprefixed and adds the trailing slash', () => {
    expect(localizeHref('en', '/shop/women')).toBe('/shop/women/');
    expect(localizeHref('en', '/')).toBe('/');
  });
  it('prefixes other languages and keeps the query and hash', () => {
    expect(localizeHref('da', '/shop/women?sort=new#top')).toBe('/da/shop/women/?sort=new#top');
    expect(localizeHref('de', '/')).toBe('/de/');
  });
  it('re-localizes an already prefixed path', () => {
    expect(localizeHref('fr', '/da/journal/')).toBe('/fr/journal/');
    expect(localizeHref('en', '/da/journal/')).toBe('/journal/');
  });
  it('maps moved VAREL routes (D13)', () => {
    expect(localizeHref('en', '/login')).toBe('/account/login/');
    expect(localizeHref('sv', '/signup')).toBe('/sv/account/register/');
    expect(localizeHref('da', '/admin')).toBe('/dashboard');
  });
  it('leaves external, hash, dashboard, API and file links alone', () => {
    expect(localizeHref('da', 'https://example.com/x')).toBe('https://example.com/x');
    expect(localizeHref('da', 'mailto:care@varel.studio')).toBe('mailto:care@varel.studio');
    expect(localizeHref('da', '#newsletter')).toBe('#newsletter');
    expect(localizeHref('da', '/dashboard/orders')).toBe('/dashboard/orders');
    expect(localizeHref('da', '/site-api/cart')).toBe('/site-api/cart');
    expect(localizeHref('da', '/rss.xml')).toBe('/rss.xml');
  });
});

describe('stripLocale / isActivePath', () => {
  it('strips only shipped, non-default prefixes', () => {
    expect(stripLocale('/da/shop/')).toBe('/shop/');
    expect(stripLocale('/da')).toBe('/');
    expect(stripLocale('/en/shop/')).toBe('/en/shop/');
    expect(stripLocale('/xx/shop/')).toBe('/xx/shop/');
  });
  it('marks the department and its children active, never home for every page', () => {
    expect(isActivePath('/da/shop/women/coats/', '/da/shop/women/')).toBe(true);
    expect(isActivePath('/shop/men/', '/shop/women/')).toBe(false);
    expect(isActivePath('/shop/', '/')).toBe(false);
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/shop/', 'https://example.com/shop/')).toBe(false);
  });
});

describe('word catalogs', () => {
  it('interpolates {{vars}} and falls back to English for missing keys', () => {
    expect(interpolate('Bag ({{count}})', {count: 2})).toBe('Bag (2)');
    const da = mergeDicts(EN_FALLBACK, {layout: {skipLink: 'Spring til indhold'}});
    expect(translate(da, 'da', 'layout', 'skipLink')).toBe('Spring til indhold');
    expect(translate(da, 'da', 'layout', 'checkout.secure')).toBe('Secure checkout');
  });
});

describe('money', () => {
  it('formats whole amounts without decimals and fractions with two', () => {
    setMoneyContext('USD', 'en');
    expect(money(148)).toBe('$148');
    expect(money(24.6)).toBe('$24.60');
    expect(priceText(0, 'Free')).toBe('Free');
  });
  it('ignores an unknown currency code', () => {
    setMoneyContext('nope', 'en');
    expect(money(10)).toBe('$10');
  });
});
