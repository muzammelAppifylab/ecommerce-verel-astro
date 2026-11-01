/* Sitemap language alternates (WP-25; VAREL worker/routes/html.ts `alternatesFor`, D7 path prefixes). */
import assert from 'node:assert/strict';
import {describe, it} from 'vitest';

import {routableLocales, sitemapAlternates} from '../src/server/lib/i18n/alternates';

const abs = (path: string) => `https://shop.test${path}`;

describe('sitemap alternates', () => {
  it('none for one language', () => {
    assert.deepEqual(sitemapAlternates('/shop/', ['en'], abs), []);
  });
  it('one per language plus x-default, with prefixed paths ending in /', () => {
    const links = sitemapAlternates('/product/coat/', routableLocales(['en', 'da', 'de', 'fr', 'es', 'sv']), abs);
    assert.equal(links.length, 7);
    assert.equal(links[0], '<xhtml:link rel="alternate" hreflang="en" href="https://shop.test/product/coat/"/>');
    assert.equal(links[1], '<xhtml:link rel="alternate" hreflang="da" href="https://shop.test/da/product/coat/"/>');
    assert.equal(links.at(-1), '<xhtml:link rel="alternate" hreflang="x-default" href="https://shop.test/product/coat/"/>');
    assert.ok(links.every(l => /href="[^"]*\/"/.test(l)));
    assert.equal(sitemapAlternates('/', ['en', 'da'], abs)[1], '<xhtml:link rel="alternate" hreflang="da" href="https://shop.test/da/"/>');
  });
  it('lists only languages the storefront can route, default first', () => {
    assert.deepEqual(routableLocales(['da', 'nl', 'en']), ['en', 'da']);
    assert.deepEqual(routableLocales(null), []);
  });
  it('no links without a site address', () => {
    assert.deepEqual(sitemapAlternates('/', ['en', 'da'], () => null), []);
  });
});
