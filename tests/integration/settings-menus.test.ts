import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {invalidateLocaleSettings} from '../../src/server/lib/locale';
import {getSettings, publicSettingsOf} from '../../src/server/lib/settings';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/** WP-01: the public store settings and navigation menus, against Postgres. */
describe.skipIf(!DATABASE_URL)('GET /site-api/settings/public and /site-api/menus (integration)', () => {
  const get = (path: string, headers: Record<string, string> = {}) => new Browser(app).request('GET', path, undefined, headers);

  const translate = (entity: string, entityId: string, field: string, locale: string, value: string) =>
    db.translation.create({data: {entity, entityId, field, locale, value, sourceHash: 'test'}});

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    invalidateLocaleSettings();
    await db.setting.update({
      where: {id: 1},
      data: {
        announcement: 'Free shipping over $150',
        freeShippingThresholdCents: 15000,
        returnReasons: ['Too big', 'Too small'],
        homeHero: {title: 'A', primaryCta: {label: 'Shop', url: '/shop/women'}, image: {src: '/i.jpg', credit: '', creditHref: ''}},
        seoTitle: '',
      },
    });
  });

  it('answers exactly the public settings, never secrets', async () => {
    const res = await get('/site-api/settings/public');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.json).sort();
    const expected = Object.keys(publicSettingsOf(await getSettings(db))).sort();
    expect(keys).toEqual(expected);
    expect(keys).toHaveLength(32);
    for (const k of ['secrets', 'emailConfig', 'orderPrefix', 'stripeSecretKey', 'lowStockThreshold']) {
      expect(res.json).not.toHaveProperty(k);
    }
    expect(res.json.freeShippingThreshold).toBe(150);
    expect(res.json.taxRate).toBe(0.25);
    expect(res.json.defaultLocale).toBe('en');
    expect((res.json.locales as string[])[0]).toBe('en');
  });

  it('translates the words for X-Locale and may be cached publicly', async () => {
    await translate('setting', '1', 'announcement', 'da', 'Gratis fragt over 150 $');
    const res = await get('/site-api/settings/public', {'x-locale': 'da'});
    expect(res.status).toBe(200);
    expect(res.json.announcement).toBe('Gratis fragt over 150 $');
    expect(res.json.seoTitle).toBe('');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('vary')).toContain('X-Locale');
  });

  it('reads the language from the cookie too, then caches privately', async () => {
    await translate('setting', '1', 'announcement', 'de', 'Kostenloser Versand');
    const res = await get('/site-api/settings/public', {cookie: 'varel_locale=de'});
    expect(res.json.announcement).toBe('Kostenloser Versand');
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });

  it('a translated hero changes words only: links and image stay the source', async () => {
    await translate('setting', '1', 'homeHero', 'da', JSON.stringify({title: 'B', primaryCta: {label: 'Køb', url: '/evil'}}));
    const res = await get('/site-api/settings/public', {'x-locale': 'da'});
    const hero = res.json.homeHero as Record<string, unknown>;
    expect(hero.title).toBe('B');
    expect(hero.primaryCta).toEqual({label: 'Køb', url: '/shop/women'});
    expect((hero.image as {src: string}).src).toBe('/i.jpg');
  });

  it('ignores a translated return-reason list that is not strings', async () => {
    await translate('setting', '1', 'returnReasons', 'da', JSON.stringify([1, 2]));
    const res = await get('/site-api/settings/public', {'x-locale': 'da'});
    expect(res.json.returnReasons).toEqual(['Too big', 'Too small']);
  });

  it('an unknown ?lang falls back to the default language', async () => {
    await translate('setting', '1', 'announcement', 'da', 'Dansk');
    const res = await get('/site-api/settings/public?lang=xx');
    expect(res.status).toBe(200);
    expect(res.json.announcement).toBe('Free shipping over $150');
  });

  it('recreates the defaults row once when it is missing', async () => {
    await db.setting.deleteMany({});
    invalidateLocaleSettings();
    const res = await get('/site-api/settings/public');
    expect(res.status).toBe(200);
    expect(res.json.storeName).toBeTruthy();
    expect(await db.setting.count()).toBe(1);
  });

  it('has no write route', async () => {
    const res = await new Browser(app).request('POST', '/site-api/settings/public', {});
    expect(res.status).toBe(404);
  });

  describe('menus', () => {
    beforeEach(async () => {
      await db.menu.createMany({
        data: [
          {key: 'header', title: 'Header', items: [{label: 'Women', url: '/shop/women/'}, {label: 'Men', url: '/shop/men/'}]},
          {key: 'footer-shop', title: 'Shop', items: [{label: 'All', url: '/shop/'}]},
          {
            key: 'footer-help',
            title: 'Help',
            items: [
              {label: 'Contact', url: '/contact/'},
              {label: 7, url: '/x/'},
              {label: 'No url'},
              {label: 'Bad', url: 'javascript:alert(1)'},
              {label: 'Proto', url: '//evil.example'},
              {label: 'Mail', url: 'mailto:hi@example.com'},
            ],
          },
          {key: 'footer-studio', title: 'Studio', items: [{label: 'About', url: '/about/'}, {label: 'Journal', url: '/journal/'}]},
        ],
      });
    });

    const menu = (list: unknown, key: string) => (list as {key: string; title: string; items: {label: string; url: string}[]}[]).find(m => m.key === key)!;

    it('lists menus by key with clean items', async () => {
      const res = await get('/site-api/menus');
      expect(res.status).toBe(200);
      const list = res.json as unknown as {key: string}[];
      expect(list.map(m => m.key)).toEqual(['footer-help', 'footer-shop', 'footer-studio', 'header']);
      expect(menu(list, 'footer-help').items).toEqual([
        {label: 'Contact', url: '/contact/'},
        {label: 'Mail', url: 'mailto:hi@example.com'},
      ]);
    });

    it('translates labels by URL, keeps URLs and titles', async () => {
      const header = await db.menu.findUniqueOrThrow({where: {key: 'header'}});
      await translate('menu', String(header.id), 'items', 'da', JSON.stringify([{label: 'Mænd', url: '/shop/men/'}, {label: 'Kvinder', url: '/shop/women/'}]));
      const res = await get('/site-api/menus', {'x-locale': 'da'});
      const m = menu(res.json, 'header');
      expect(m.title).toBe('Header');
      expect(m.items).toEqual([
        {label: 'Kvinder', url: '/shop/women/'},
        {label: 'Mænd', url: '/shop/men/'},
      ]);
      expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    });

    it('matches by position only when the lengths agree', async () => {
      const studio = await db.menu.findUniqueOrThrow({where: {key: 'footer-studio'}});
      const shop = await db.menu.findUniqueOrThrow({where: {key: 'footer-shop'}});
      await translate('menu', String(studio.id), 'items', 'da', JSON.stringify([{label: 'Om', url: '/da/om/'}, {label: 'Journal', url: '/da/journal/'}]));
      await translate('menu', String(shop.id), 'items', 'da', JSON.stringify([{label: 'Alt', url: '/a/'}, {label: 'Mere', url: '/b/'}]));
      const res = await get('/site-api/menus', {'x-locale': 'da'});
      expect(menu(res.json, 'footer-studio').items).toEqual([
        {label: 'Om', url: '/about/'},
        {label: 'Journal', url: '/journal/'},
      ]);
      expect(menu(res.json, 'footer-shop').items).toEqual([{label: 'All', url: '/shop/'}]);
    });
  });
});
