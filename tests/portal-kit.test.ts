import {describe, expect, it} from 'vitest';

import {stringifySearch, parsePeriod, parseSearch} from '../src/portal/queries/search-params';
import {niceMax} from '../src/portal/ui/chart';
import {fromISODate, rangeLabel, toISODate} from '../src/portal/ui/date-range';
import {fitWithin, imageFileProblem} from '../src/portal/ui/image-uploader';
import {cleanAmount, parseTags} from '../src/portal/ui/inputs';
import {isRichHtml, normalizeHref, safeHref} from '../src/portal/ui/rich-text-editor';
import {clipText} from '../src/portal/ui/seo-panel';
import {move} from '../src/portal/ui/sortable';
import {fieldLabel, richToPlain, sameShape, setAt, textLeaves} from '../src/portal/ui/translation-editor';

/** The pure helpers behind the dashboard kit additions (docs/migration/PLAN.md §5 F5). */

describe('MoneyInput / TagInput helpers', () => {
  it('keeps digits and one decimal point', () => {
    expect(cleanAmount('$1,234.5.6')).toBe('1234.56');
    expect(cleanAmount('abc')).toBe('');
    expect(cleanAmount('12')).toBe('12');
  });
  it('splits, lowercases and de-duplicates tags', () => {
    expect(parseTags(' Linen, summer ,linen,,New', ['new'])).toEqual(['linen', 'summer']);
  });
});

describe('rich text links', () => {
  it('refuses script and data links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('/shop/')).toBe('/shop/');
    expect(safeHref('#size')).toBe('#size');
  });
  it('normalizes what a person types', () => {
    expect(normalizeHref('varel.studio')).toBe('https://varel.studio');
    expect(normalizeHref('hello@varel.studio')).toBe('mailto:hello@varel.studio');
    expect(normalizeHref('  ')).toBeNull();
    expect(normalizeHref('javascript:void(0)')).toBeNull();
  });
  it('tells editor HTML from plain text', () => {
    expect(isRichHtml('<p>Hi</p>')).toBe(true);
    expect(isRichHtml('Plain **markdown**')).toBe(false);
  });
});

describe('SortableList move', () => {
  it('moves an item without touching the input', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(move(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(move(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('ImageUploader checks', () => {
  it('accepts web images up to 8 MB', () => {
    expect(imageFileProblem({name: 'a.jpg', type: 'image/jpeg', size: 1000})).toBeNull();
    expect(imageFileProblem({name: 'a.gif', type: 'image/gif', size: 1000})).toMatch(/JPEG, PNG, WebP or AVIF/);
    expect(imageFileProblem({name: 'a.png', type: 'image/png', size: 9 * 1024 * 1024})).toMatch(/8 MB/);
    expect(imageFileProblem({name: 'a.png', type: 'image/png', size: 0})).toMatch(/empty/);
  });
  it('scales the longest edge down, never up', () => {
    expect(fitWithin(4800, 3200, 2400)).toEqual({width: 2400, height: 1600});
    expect(fitWithin(800, 600, 2400)).toEqual({width: 800, height: 600});
  });
});

describe('charts and dates', () => {
  it('rounds the axis max to a tidy value', () => {
    expect(niceMax(0)).toBe(100);
    expect(niceMax(87)).toBe(100);
    expect(niceMax(1234)).toBe(2000);
    expect(niceMax(2100)).toBe(2500);
  });
  it('round-trips ISO dates and labels a range', () => {
    const d = fromISODate('2026-10-03');
    expect(d && toISODate(d)).toBe('2026-10-03');
    expect(fromISODate('nope')).toBeUndefined();
    expect(rangeLabel(undefined, undefined, 'Date')).toBe('Date');
    expect(rangeLabel('2026-10-03', undefined, 'Date')).toMatch(/^From /);
    expect(rangeLabel(undefined, '2026-10-21', 'Date')).toMatch(/^Until /);
  });
  it('reads the period from the URL (30 days is the default, so never in it)', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod('all')).toBe('all');
    expect(parsePeriod('30')).toBeUndefined();
    expect(parsePeriod('x')).toBeUndefined();
  });
  it('writes and reads plain query strings', () => {
    const s = stringifySearch({payment: ['Paid', 'Pending'], page: 2, q: ''});
    expect(parseSearch(s)).toMatchObject({payment: 'Paid,Pending', page: '2'});
  });
});

describe('TranslationEditor helpers', () => {
  const hero = {title: 'New in', cta: {label: 'Shop now', href: '/shop/'}, image: 'https://x/y.jpg'};
  it('finds the text leaves of structured fields, skipping links and media', () => {
    expect(textLeaves(hero).map(l => l.key)).toEqual(['title', 'cta.label']);
  });
  it('sets a leaf on a copy and keeps the shape', () => {
    const next = setAt(hero, ['cta', 'label'], 'Køb nu');
    expect((next as typeof hero).cta.label).toBe('Køb nu');
    expect(hero.cta.label).toBe('Shop now');
    expect(sameShape(hero, next)).toBe(true);
    expect(sameShape(hero, {...hero, cta: 'x'})).toBe(false);
  });
  it('labels fields and flattens rich text', () => {
    expect(fieldLabel('seoTitle')).toBe('SEO title');
    expect(fieldLabel('careNotes')).toBe('Care Notes');
    expect(richToPlain('<p>Linen &amp; wool</p><p>Cut&nbsp;loose</p>')).toBe('Linen & wool\nCut loose');
  });
});

describe('SeoPanel preview', () => {
  it('clips like a results list', () => {
    expect(clipText('Short', 60)).toBe('Short');
    expect(clipText('a'.repeat(70), 60)).toHaveLength(60);
    expect(clipText('a'.repeat(70), 60).endsWith('…')).toBe(true);
  });
});
