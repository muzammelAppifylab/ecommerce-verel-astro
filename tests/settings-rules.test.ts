import {describe, expect, it} from 'vitest';

import {diff, fromPercent, toPercent, withDefaults} from '../src/portal/screens/settings/shared';
import {isCatchAll} from '../src/portal/screens/settings/shipping/dialogs';
import {keyMode} from '../src/server/routes/admin/payments';
import {settingsPatch} from '../src/server/routes/admin/settings';
import type {StoreSettings} from '../src/lib/types/admin/store';

/** WP-23: the store settings validator (`PATCH /manage/settings`) and the screens' shared helpers. */
const ok = (input: unknown) => {
  const r = settingsPatch.safeParse(input);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};
const fails = (input: unknown) => !settingsPatch.safeParse(input).success;
const paths = (input: unknown) => {
  const r = settingsPatch.safeParse(input);
  return r.success ? [] : r.error.issues.map(i => i.path.join('.'));
};
const s = (n: number) => 'a'.repeat(n);

describe('settingsPatch limits (client = server)', () => {
  const cases: [string, number][] = [
    ['storeName', 80],
    ['announcement', 160],
    ['legalName', 120],
    ['vatNumber', 40],
    ['businessAddress', 300],
    ['taxName', 40],
    ['termsText', 500],
    ['seoTitle', 120],
    ['seoDescription', 320],
    ['emailFromName', 80],
  ];
  it.each(cases)('%s accepts %i characters and refuses one more', (key, max) => {
    expect(ok({[key]: s(max)})[key as 'storeName']).toBe(s(max));
    expect(fails({[key]: s(max + 1)})).toBe(true);
  });

  it('whole-number limits', () => {
    expect(ok({lowStockThreshold: 1000}).lowStockThreshold).toBe(1000);
    expect(fails({lowStockThreshold: 1001})).toBe(true);
    expect(ok({returnWindowDays: 365}).returnWindowDays).toBe(365);
    expect(fails({returnWindowDays: 366})).toBe(true);
    expect(fails({abandonedCartHours: 0})).toBe(true);
    expect(ok({abandonedCartHours: 720}).abandonedCartHours).toBe(720);
    expect(fails({abandonedCartHours: 721})).toBe(true);
    expect(fails({lowStockThreshold: 1.5})).toBe(true);
  });

  it('order prefix', () => {
    expect(ok({orderPrefix: 'vrl-'}).orderPrefix).toBe('VRL-');
    expect(fails({orderPrefix: 'VRL1'})).toBe(true);
    expect(fails({orderPrefix: 'ABCDEFGHIJK'})).toBe(true);
    expect(fails({orderPrefix: 'V R'})).toBe(true);
  });

  it('currency', () => {
    expect(ok({currency: 'dkk'}).currency).toBe('DKK');
    expect(fails({currency: 'XXQ'})).toBe(true);
    expect(fails({currency: 'EURO'})).toBe(true);
  });

  it('tax rate is a fraction with four decimals', () => {
    expect(ok({taxRate: 0.08254}).taxRate).toBe(0.0825);
    expect(fails({taxRate: 1.1})).toBe(true);
    expect(fails({taxRate: -0.1})).toBe(true);
  });

  it('free shipping threshold rounds to cents', () => {
    expect(ok({freeShippingThreshold: 99.999}).freeShippingThreshold).toBe(100);
    expect(fails({freeShippingThreshold: -1})).toBe(true);
  });

  it('return reasons: case-insensitive de-dupe, at most 12', () => {
    expect(ok({returnReasons: ['Too small', ' too small ', 'Damaged']}).returnReasons).toEqual(['Too small', 'Damaged']);
    expect(ok({returnReasons: Array.from({length: 12}, (_, i) => `R${i}`)}).returnReasons).toHaveLength(12);
    expect(fails({returnReasons: Array.from({length: 13}, (_, i) => `R${i}`)})).toBe(true);
    expect(fails({returnReasons: [s(81)]})).toBe(true);
  });

  it('social links: empties removed, unknown networks and paths refused', () => {
    expect(ok({socialLinks: {instagram: 'https://instagram.com/varel', x: ''}}).socialLinks).toEqual({
      instagram: 'https://instagram.com/varel',
    });
    expect(fails({socialLinks: {myspace: 'https://myspace.com/x'}})).toBe(true);
    expect(paths({socialLinks: {instagram: '/path'}})).toEqual(['socialLinks.instagram']);
  });

  it('image links: https or a site path only', () => {
    expect(fails({logoUrl: 'http://x.test/logo.png'})).toBe(true);
    expect(fails({logoUrl: '//evil.test/logo.png'})).toBe(true);
    expect(fails({logoUrl: 'javascript:alert(1)'})).toBe(true);
    expect(ok({logoUrl: '/x.png'}).logoUrl).toBe('/x.png');
    expect(ok({logoUrl: 'https://cdn.test/logo.webp'}).logoUrl).toBe('https://cdn.test/logo.webp');
    expect(ok({logoUrl: ''}).logoUrl).toBeNull();
    expect(ok({ogImage: null}).ogImage).toBeNull();
  });

  it('phone pattern', () => {
    expect(ok({phone: ''}).phone).toBe('');
    expect(ok({phone: '+45 12 34 56 78'}).phone).toBe('+45 12 34 56 78');
    expect(fails({phone: 'call me'})).toBe(true);
  });

  it('Stripe publishable key', () => {
    expect(fails({stripePublishableKey: 'sk_test_x'})).toBe(true);
    expect(ok({stripePublishableKey: ''}).stripePublishableKey).toBeNull();
    expect(ok({stripePublishableKey: 'pk_test_abc123'}).stripePublishableKey).toBe('pk_test_abc123');
  });

  it('email config: at most 10 keys, https endpoint', () => {
    const many = Object.fromEntries(Array.from({length: 11}, (_, i) => [`k${String.fromCharCode(97 + i)}`, 'v']));
    expect(fails({emailConfig: many})).toBe(true);
    expect(paths({emailConfig: {endpoint: 'http://hook.test'}})).toEqual(['emailConfig.endpoint']);
    expect(ok({emailConfig: {endpoint: 'https://hook.test'}}).emailConfig).toEqual({endpoint: 'https://hook.test'});
  });

  it('emails are lower-cased; optional ones clear to null', () => {
    expect(ok({supportEmail: 'Hello@Varel.Test'}).supportEmail).toBe('hello@varel.test');
    expect(ok({emailReplyTo: ''}).emailReplyTo).toBeNull();
    expect(fails({supportEmail: 'nope'})).toBe(true);
  });

  it('home hero: {} stays {}', () => {
    expect(ok({homeHero: {}}).homeHero).toEqual({});
  });

  it('locales: lower-cased and de-duped', () => {
    expect(ok({locales: ['EN', 'da', 'en']}).locales).toEqual(['en', 'da']);
    expect(fails({locales: []})).toBe(true);
    expect(fails({defaultLocale: 'english'})).toBe(true);
  });

  it('secrets and unknown keys are stripped', () => {
    expect(ok({secrets: {stripeSecretKey: true}, storeName: 'VAREL', nope: 1})).toEqual({storeName: 'VAREL'});
  });
});

describe('settings screen helpers', () => {
  it('percent and fraction', () => {
    expect(toPercent(0.0825)).toBe('8.25');
    expect(toPercent(0.25)).toBe('25');
    expect(fromPercent('8.25')).toBe(0.0825);
    expect(fromPercent('25')).toBe(0.25);
  });

  it('diff returns only changed keys', () => {
    const base = withDefaults({storeName: 'VAREL', supportEmail: 'a@b.test', homeHero: null, secrets: {}} as unknown as StoreSettings);
    expect(diff({storeName: 'VAREL', announcement: base.announcement}, base)).toEqual({});
    expect(diff({storeName: 'New', locales: [...base.locales]}, base)).toEqual({storeName: 'New'});
  });

  it('catch-all zone and Stripe key modes', () => {
    expect(isCatchAll({countries: []})).toBe(true);
    expect(isCatchAll({countries: ['Denmark']})).toBe(false);
    expect(keyMode('sk_test_x')).toBe('test');
    expect(keyMode('pk_live_x')).toBe('live');
    expect(keyMode('rk_live_x')).toBe('live');
    expect(keyMode('')).toBeNull();
    expect(keyMode(null)).toBeNull();
  });
});
