import {describe, expect, it} from 'vitest';

import {DEFAULT_HERO, heroDefaults, resolveHero, safeHref} from '../src/components/home/hero';
import {mergeHero, publicFromRow} from '../src/server/routes/settings';
import {menuItems, safeMenuUrl, translateItems} from '../src/server/routes/menus';

describe('resolveHero (WP-01)', () => {
  it('falls back to the designed hero', () => {
    expect(resolveHero(undefined)).toEqual(DEFAULT_HERO);
    expect(resolveHero(null)).toEqual(DEFAULT_HERO);
    expect(resolveHero({})).toEqual(DEFAULT_HERO);
  });

  it('whitespace-only words fall back, set words are kept', () => {
    const h = resolveHero({title: '   ', eyebrow: '\n', body: ' Body '});
    expect(h.title).toBe(DEFAULT_HERO.title);
    expect(h.eyebrow).toBe(DEFAULT_HERO.eyebrow);
    expect(h.body).toBe('Body');
  });

  it('a CTA needs both label and url (and a safe url)', () => {
    expect(resolveHero({primaryCta: {label: '', url: '/x/'}}).primaryCta).toEqual(DEFAULT_HERO.primaryCta);
    expect(resolveHero({primaryCta: {label: 'Go', url: ' '}}).primaryCta).toEqual(DEFAULT_HERO.primaryCta);
    expect(resolveHero({primaryCta: {label: 'Go', url: 'javascript:alert(1)'}}).primaryCta).toEqual(DEFAULT_HERO.primaryCta);
    expect(resolveHero({secondaryCta: {label: 'Go', url: '/x/'}}).secondaryCta).toEqual({label: 'Go', url: '/x/'});
  });

  it('keeps a stored image with a src', () => {
    expect(resolveHero({image: {src: '', credit: '', creditHref: ''}}).image).toBe(DEFAULT_HERO.image);
    expect(resolveHero({image: {src: '/x.jpg', credit: '', creditHref: ''}}).image.src).toBe('/x.jpg');
    expect(resolveHero({image: {src: 'javascript:x', credit: '', creditHref: ''}}).image).toBe(DEFAULT_HERO.image);
  });

  it('safeHref accepts store paths, web and mail links only', () => {
    for (const ok of ['/shop/', '/', 'https://a.b', 'http://a.b/c', 'mailto:x@y.z']) expect(safeHref(ok)).toBe(true);
    for (const bad of ['//evil.com', '/\\evil.com', 'javascript:alert(1)', 'data:text/html,x', '', '  ', null, 'shop']) {
      expect(safeHref(bad)).toBe(false);
    }
  });

  it('heroDefaults translates the words and keeps the designed links', () => {
    const d = heroDefaults(k => `da:${k}`);
    expect(d.title).toBe('da:hero.title');
    expect(d.primaryCta).toEqual({label: 'da:hero.primaryCta', url: '/shop/women'});
    expect(d.secondaryCta.url).toBe('/shop/men');
    expect(d.image).toBe(DEFAULT_HERO.image);
  });
});

describe('settings route helpers (WP-01)', () => {
  it('mergeHero takes words only from the translation', () => {
    const source = {title: 'A', primaryCta: {label: 'Shop', url: '/shop/women'}, image: {src: '/i.jpg', credit: '', creditHref: ''}};
    const out = mergeHero(source, {title: 'B', primaryCta: {label: 'Køb', url: '/evil'}, image: {src: '/x.jpg'}});
    expect(out).toEqual({title: 'B', primaryCta: {label: 'Køb', url: '/shop/women'}, image: source.image});
    expect(mergeHero(source, null)).toBe(source);
    expect(mergeHero(source, [1])).toBe(source);
  });

  it('publicFromRow converts money, tax, social links and locales', () => {
    const row = {
      storeName: 'VAREL',
      currency: 'EUR',
      pricesIncludeTax: true,
      taxName: 'VAT',
      taxRate: {toString: () => '0.2500'},
      freeShippingThresholdCents: 15000,
      announcement: '',
      supportEmail: 's@example.com',
      phone: '',
      legalName: '',
      vatNumber: '',
      businessAddress: '',
      logoUrl: '',
      socialLinks: {instagram: 'https://i', x: '', other: 'https://o'},
      guestCheckout: true,
      requirePhone: false,
      orderNotes: true,
      termsText: '',
      hideSoldOut: false,
      returnWindowDays: 30,
      returnReasons: [],
      paymentProvider: 'paypal',
      stripePublishableKey: '',
      seoTitle: '',
      seoDescription: '',
      ogImage: '',
      homeHero: [1, 2],
      cookieConsent: true,
      reviewsEnabled: true,
      analyticsEnabled: true,
      defaultLocale: 'da',
      locales: ['en', 'da', 'de'],
    } as unknown as Parameters<typeof publicFromRow>[0];
    const s = publicFromRow(row);
    expect(s.freeShippingThreshold).toBe(150);
    expect(s.taxRate).toBe(0.25);
    expect(s.socialLinks).toEqual({instagram: 'https://i'});
    expect(s.paymentProvider).toBe('simulated');
    expect(s.homeHero).toEqual({});
    expect(s.locales).toEqual(['da', 'en', 'de']);
  });
});

describe('menu helpers (WP-01)', () => {
  it('menuItems keeps well-formed items with safe URLs', () => {
    expect(menuItems(null)).toEqual([]);
    expect(menuItems({label: 'x', url: '/'})).toEqual([]);
    expect(
      menuItems([
        {label: ' Women ', url: ' /shop/women/ '},
        {label: 3, url: '/x/'},
        {label: 'No url'},
        {label: 'JS', url: 'javascript:alert(1)'},
        {label: 'Proto', url: '//evil'},
        {label: 'Tel', url: 'tel:+4512345678'},
        {label: 'Web', url: 'https://example.com', extra: true},
      ])
    ).toEqual([
      {label: 'Women', url: '/shop/women/'},
      {label: 'Tel', url: 'tel:+4512345678'},
      {label: 'Web', url: 'https://example.com'},
    ]);
    expect(safeMenuUrl('data:x')).toBe(false);
  });

  it('caps the items per menu', () => {
    expect(menuItems(Array.from({length: 40}, (_, i) => ({label: `L${i}`, url: `/p${i}/`})))).toHaveLength(20);
  });

  it('translateItems matches by URL, then by position when lengths agree', () => {
    const src = [
      {label: 'Women', url: '/w/'},
      {label: 'Men', url: '/m/'},
    ];
    expect(translateItems(src, [{label: 'Mænd', url: '/m/'}])).toEqual([
      {label: 'Women', url: '/w/'},
      {label: 'Mænd', url: '/m/'},
    ]);
    expect(translateItems(src, [{label: 'A', url: '/a/'}, {label: 'B', url: '/b/'}])).toEqual([
      {label: 'A', url: '/w/'},
      {label: 'B', url: '/m/'},
    ]);
    expect(translateItems(src, [{label: 'A', url: '/a/'}])).toEqual(src);
  });
});
