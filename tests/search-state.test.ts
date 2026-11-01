import {describe, expect, it} from 'vitest';

import {
  categoryHref,
  resultLine,
  searchEvent,
  searchUrl,
  termOf,
  visibleSections,
} from '../src/components/search/search-state';
import type {SearchResponse} from '../src/lib/types/catalog';

const answer = (p: number, c: number, j: number): SearchResponse =>
  ({
    query: 'wool',
    products: Array.from({length: p}, (_, i) => ({id: `p${i}`})),
    categories: Array.from({length: c}, (_, i) => ({dept: 'Women', category: `C${i}`, count: 1})),
    posts: Array.from({length: j}, (_, i) => ({slug: `s${i}`})),
  }) as unknown as SearchResponse;

describe('search page state (WP-08)', () => {
  it('shows the sections of the selected tab', () => {
    const data = answer(2, 1, 0);
    expect(visibleSections(data, 'all')).toEqual({total: 3, showP: true, showC: true, showJ: false, tabEmpty: false});
    expect(visibleSections(data, 'products')).toMatchObject({showP: true, showC: false, showJ: false, tabEmpty: false});
    expect(visibleSections(data, 'categories')).toMatchObject({showP: false, showC: true, tabEmpty: false});
    expect(visibleSections(data, 'journal')).toMatchObject({showJ: false, tabEmpty: true, total: 3});
  });

  it('is not "tab empty" without results or data', () => {
    expect(visibleSections(answer(0, 0, 0), 'journal').tabEmpty).toBe(false);
    expect(visibleSections(null, 'all')).toEqual({total: 0, showP: false, showC: false, showJ: false, tabEmpty: false});
  });

  it('picks the result line', () => {
    const base = {term: '', loading: false, failed: false, hasData: false, total: 0};
    expect(resultLine(base)).toEqual({key: 'search.prompt'});
    expect(resultLine({...base, term: 'wool', loading: true})).toEqual({key: 'search.searching', vars: {term: 'wool'}});
    expect(resultLine({...base, term: 'wool', failed: true})).toEqual({key: 'search.unavailable'});
    expect(resultLine({...base, term: 'wool', hasData: true, total: 4})).toEqual({
      key: 'search.results',
      vars: {count: 4, term: 'wool'},
    });
    expect(resultLine({...base, term: 'zzz', hasData: true, total: 0})).toEqual({
      key: 'search.results',
      vars: {count: 0, term: 'zzz'},
    });
  });

  it('builds the page URL', () => {
    expect(searchUrl('', 'all')).toBe('/search/');
    expect(searchUrl('   ', 'journal')).toBe('/search/?tab=journal');
    expect(searchUrl('wool', 'all')).toBe('/search/?q=wool');
    expect(searchUrl('wool coat ', 'products')).toBe('/search/?q=wool+coat+&tab=products');
    expect(searchUrl('uld', null, 'da')).toBe('/da/search/?q=uld');
  });

  it('trims and clips the term', () => {
    expect(termOf('  wool  ')).toBe('wool');
    expect(termOf(undefined)).toBe('');
    expect(termOf('x'.repeat(250))).toHaveLength(200);
  });

  it('links categories by stored slug, else by name', () => {
    expect(categoryHref({dept: 'Women', category: 'Shoulder Bags', count: 1})).toBe('/shop/women/shoulder-bags/');
    expect(categoryHref({dept: 'Women', category: 'Bags', count: 1, deptSlug: 'w', categorySlug: 'b'}, 'de')).toBe(
      '/de/shop/w/b/'
    );
  });

  it('shapes the analytics event', () => {
    expect(searchEvent('Wool Coat', 7)).toEqual({query: 'wool coat', results: 7});
    expect(searchEvent('A'.repeat(200), 0).query).toBe('a'.repeat(120));
  });
});
