import {describe, expect, it} from 'vitest';

import {queryKey} from '../src/components/home/fetch';
import {HOME_PHOTOS} from '../src/components/home/photos';
import {
  featuredCollectionsOf,
  featuredSlice,
  initialSize,
  queryFor,
  rowData,
  scrolledRow,
  stockFor,
} from '../src/components/home/sections';
import type {Department, Product} from '../src/lib/types/catalog';
import type {CollectionSummary} from '../src/lib/types/collections';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

const dept = (slug: string, cats: [string, number][]): Department => ({
  name: slug,
  slug,
  count: cats.reduce((n, [, c]) => n + c, 0),
  categories: cats.map(([s, count]) => ({name: s, slug: s, count})),
});

describe('home sections (WP-01)', () => {
  it('queryFor maps filters to the products query', () => {
    expect(queryFor('all', 'featured')).toEqual({sort: 'featured', limit: 12});
    expect(queryFor('new', 'price-asc')).toEqual({sort: 'price-asc', limit: 12, tag: 'new'});
    expect(queryFor('women', 'price-desc')).toEqual({sort: 'price-desc', limit: 12, dept: 'women'});
  });

  it('queryKey is stable across key order', () => {
    expect(queryKey({sort: 'featured', limit: 12, dept: 'men'})).toBe(queryKey({dept: 'men', limit: 12, sort: 'featured'}));
  });

  it('featuredSlice keeps whole rows of four', () => {
    const n = (k: number) => featuredSlice(Array.from({length: k}, (_, i) => i)).length;
    expect([n(8), n(7), n(6), n(4), n(3), n(0)]).toEqual([8, 4, 4, 4, 3, 0]);
  });

  it('featuredCollectionsOf drops empty collections and keeps three', () => {
    const c = (slug: string, productCount: number) => ({slug, productCount}) as CollectionSummary;
    const r = featuredCollectionsOf([c('a', 2), c('b', 0), c('c', 1), c('d', 3), c('e', 4)]);
    expect(r.items.map(x => x.slug)).toEqual(['a', 'c', 'd']);
    expect(r.three).toBe(true);
    expect(featuredCollectionsOf([c('a', 1)]).three).toBe(false);
    expect(featuredCollectionsOf(null).items).toEqual([]);
  });

  it('stockFor spells out the last pieces', () => {
    expect(stockFor(null, t).label).toBe('piece.stock.download');
    expect(stockFor(0, t)).toEqual({label: 'piece.stock.soldOut', cls: 'text-signal-critical'});
    expect(stockFor(-1, t).label).toBe('piece.stock.soldOut');
    expect(stockFor(2, t).label).toBe('piece.stock.final:{"count":2,"word":"piece.words.2"}');
    expect(stockFor(6, t).cls).toBe('text-signal-notice');
    expect(stockFor(7, t).label).toBe('piece.stock.in');
  });

  it('initialSize prefers M in stock, then the first size in stock', () => {
    const p = (inv: Record<string, number>) =>
      ({
        sizes: Object.keys(inv),
        swatches: [{name: 'Stone', hex: '#ccc'}],
        variants: Object.entries(inv).map(([size, inventory]) => ({color: 'Stone', size, inventory, options: {}})),
      }) as unknown as Product;
    expect(initialSize(p({S: 1, M: 1, L: 1}))).toBe('M');
    expect(initialSize(p({S: 0, M: 0, L: 2}))).toBe('L');
    expect(initialSize(p({S: 0, M: 0}))).toBe('S');
    expect(initialSize(p({}))).toBeNull();
  });

  it('rowData sums categories over departments and links to the biggest', () => {
    const tax = [dept('women', [['outerwear', 2], ['knitwear', 3], ['shirts', 0]]), dept('men', [['outerwear', 4], ['shirts', 1]])];
    const rows = rowData(tax, k => k.toUpperCase());
    expect(rows.map(r => [r.key, r.count, r.num])).toEqual([
      ['outerwear', 6, '01'],
      ['knitwear', 3, '02'],
      ['shirting', 1, '03'],
    ]);
    expect(rows[0].link).toBe('/shop/men/outerwear/');
    expect(rows[2].link).toBe('/shop/men/shirts/');
    expect(rows[0].name).toBe('OUTERWEAR');
    expect(rows[1].photo).toBe(HOME_PHOTOS.new1a);
  });

  it('rowData without a taxonomy shows the four rows linking to the shop', () => {
    const rows = rowData(null, k => k, 'da');
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.link === '/da/shop/')).toBe(true);
    expect(rows[3].num).toBe('04');
  });

  it('scrolledRow follows the section through the viewport', () => {
    expect(scrolledRow(800, 900, 1000)).toBe(0);
    expect(scrolledRow(800, 0, 1000)).toBe(2);
    expect(scrolledRow(800, -1000, 1000)).toBe(5);
  });
});
