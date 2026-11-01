import {describe, expect, it} from 'vitest';


import {DEFAULT_HERO, heroFormOf, resolveHero, toHero, validateHero} from '../src/portal/screens/navigation/hero';
import {blockFromPost, blockToPost, listItems, validatePage} from '../src/portal/screens/pages/blocks';
import {MENU_KEYS, isMenuUrl, menuItems, menuSchema} from '../src/server/routes/admin/menus';
import {block, isImageSrc} from '../src/server/routes/admin/pages';
import type {PostBlock} from '../src/lib/types/content';

/** WP-07: menu, page block and home hero rules (server and dashboard). */
describe('menus', () => {
  it('drops malformed stored items', () => {
    expect(menuItems(null)).toEqual([]);
    expect(menuItems([{label: 'Women', url: '/shop/women/', extra: 1}, {label: 3, url: '/'}, null, 'x'])).toEqual([{label: 'Women', url: '/shop/women/'}]);
  });

  it('accepts store paths, http(s) and mailto links only', () => {
    for (const ok of ['/shop/', '/x', 'https://varel.studio/', 'http://a.test', 'mailto:care@varel.studio']) expect(isMenuUrl(ok)).toBe(true);
    for (const bad of ['//evil.test', 'javascript:alert(1)', 'shop', 'https://a b', '']) expect(isMenuUrl(bad)).toBe(false);
  });

  it('keeps a menu to 20 links and requires labels', () => {
    const items = Array.from({length: 21}, (_, i) => ({label: `L${i}`, url: '/'}));
    const tooMany = menuSchema.safeParse({title: 'Shop', items});
    expect(tooMany.success).toBe(false);
    const noLabel = menuSchema.safeParse({title: 'Shop', items: [{label: ' ', url: '/'}]});
    expect(noLabel.success).toBe(false);
    expect(menuSchema.safeParse({title: '', items: []}).success).toBe(false);
    expect(menuSchema.parse({title: ' Shop ', items: [{label: ' Women ', url: ' /shop/women/ '}]})).toEqual({
      title: 'Shop',
      items: [{label: 'Women', url: '/shop/women/'}],
    });
  });

  it('has the four storefront menus in display order', () => {
    expect(MENU_KEYS.map(m => m.key)).toEqual(['header', 'footer-studio', 'footer-shop', 'footer-help']);
  });
});

describe('page blocks', () => {
  it('validates each block type', () => {
    expect(block.safeParse({type: 'p', text: 'Hello'}).success).toBe(true);
    expect(block.safeParse({type: 'p', text: '  '}).success).toBe(false);
    expect(block.safeParse({type: 'list', items: []}).success).toBe(false);
    expect(block.safeParse({type: 'video', src: 'x'}).success).toBe(false);
    expect(block.parse({type: 'image', image: {src: 'https://images.unsplash.com/x'}})).toEqual({
      type: 'image',
      image: {src: 'https://images.unsplash.com/x', credit: '', creditHref: ''},
    });
    expect(block.safeParse({type: 'image', image: {src: 'javascript:alert(1)'}}).success).toBe(false);
  });

  it('accepts https, uploaded files and the site images', () => {
    expect(isImageSrc('https://a.test/x.jpg')).toBe(true);
    expect(isImageSrc('/__platform/files/abc')).toBe(true);
    expect(isImageSrc('/images/hero-studio-rail.jpg')).toBe(true);
    expect(isImageSrc('http://a.test/x.jpg')).toBe(false);
    expect(isImageSrc('//a.test/x.jpg')).toBe(false);
  });

  it('round-trips editor blocks', () => {
    const blocks = [
      {type: 'p', text: 'P'},
      {type: 'quote', text: 'Q', cite: 'C'},
      {type: 'image', image: {src: 'https://a.test/i.jpg', credit: 'X', creditHref: ''}, caption: 'Cap'},
      {type: 'list', items: ['a', 'b']},
    ] satisfies PostBlock[];
    for (const b of blocks) expect(blockToPost(blockFromPost(b))).toEqual(b);
    expect(listItems('- one\n\n• two\n * three')).toEqual(['one', 'two', 'three']);
  });

  it('mirrors the server rules in the editor', () => {
    const errs = validatePage({slug: 'Bad Slug', title: '', published: true, body: [{type: 'p', text: ''}, {type: 'list', items: []}], seoTitle: null, seoDescription: null});
    expect(errs).toMatchObject({
      title: 'Give the page a title.',
      slug: 'Use lowercase letters, numbers and hyphens.',
      'body.0.text': 'Write the text or remove the block.',
      'body.1.items': 'Add at least one list item.',
    });
    expect(validatePage({slug: 'privacy', title: 'Privacy', published: true, body: [{type: 'p', text: 'x'}], seoTitle: null, seoDescription: null})).toEqual({});
  });
});

describe('home hero', () => {
  it('shows the designed hero when nothing is stored', () => {
    expect(resolveHero({})).toEqual(DEFAULT_HERO);
    expect(toHero(heroFormOf({}))).toEqual({});
  });

  it('stores only what differs from the design', () => {
    const f = {...heroFormOf(undefined), title: 'New headline', primaryLabel: 'Shop all'};
    expect(toHero(f)).toEqual({title: 'New headline', primaryCta: {label: 'Shop all', url: '/shop/women'}});
  });

  it('validates headline, buttons and image', () => {
    const f = {...heroFormOf(undefined), title: '', primaryUrl: 'javascript:x', imageSrc: ''};
    expect(validateHero(f)).toEqual({title: 'Enter a headline.', primaryUrl: 'Start with / or https://.', imageSrc: 'Upload an image or paste its URL.'});
  });
});
