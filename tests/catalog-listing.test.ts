import {describe, expect, it} from 'vitest';

import {
  activeCount,
  clearFilters,
  listingHref,
  parseListingSearch,
  priceCeiling,
  sortItems,
  toApiQuery,
  toggleValue,
  withMaxPrice,
  withSort,
} from '../src/components/catalog/listing';
import type {Product} from '../src/lib/types/catalog';
import {facetCounts} from '../src/server/routes/catalog';

const sp = (s: string) => new URLSearchParams(s);

describe('parseListingSearch', () => {
  it('keeps valid keys, splits commas, drops malformed values', () => {
    expect(parseListingSearch(sp('sort=price-asc&color=Stone,Black&size=M&maxPrice=200'))).toEqual({
      sort: 'price-asc',
      color: ['Stone', 'Black'],
      size: ['M'],
      maxPrice: 200,
    });
    expect(parseListingSearch(sp('sort=featured'))).toEqual({});
    expect(parseListingSearch(sp('sort=bogus&maxPrice=-1&color=&brand=,'))).toEqual({});
    expect(parseListingSearch(sp('maxPrice=abc'))).toEqual({});
    expect(parseListingSearch(sp('color=Stone&color=Black'))).toEqual({color: ['Stone', 'Black']});
  });

  it('ignores ?category= on category pages (the route category wins)', () => {
    expect(parseListingSearch(sp('category=Shirts&color=Stone'), 'category')).toEqual({color: ['Stone']});
    expect(parseListingSearch(sp('category=Shirts'), 'shop')).toEqual({category: ['Shirts']});
  });
});

describe('listing state changes', () => {
  it('toggles values, removing emptied keys', () => {
    const on = toggleValue({}, 'color', 'Stone');
    expect(on).toEqual({color: ['Stone']});
    expect(toggleValue(on, 'color', 'Stone')).toEqual({});
  });

  it('sort featured is never stored; clear keeps the sort; activeCount counts values and price', () => {
    expect(withSort({sort: 'name'}, 'featured')).toEqual({});
    const s = withMaxPrice({sort: 'newest', color: ['Stone', 'Black'], size: ['M']}, 150);
    expect(activeCount(s)).toBe(4);
    expect(clearFilters(s)).toEqual({sort: 'newest'});
    expect(withMaxPrice(s, undefined).maxPrice).toBeUndefined();
  });
});

describe('listingHref', () => {
  it('writes keys in order, comma-joined, empty ones omitted, path kept', () => {
    expect(listingHref('/shop/', {maxPrice: 200, color: ['Stone', 'Black'], sort: 'price-asc'})).toBe(
      '/shop/?sort=price-asc&color=Stone,Black&maxPrice=200'
    );
    expect(listingHref('/da/shop/women/', {})).toBe('/da/shop/women/');
    expect(listingHref('/shop/', {material: ['Organic cotton']})).toBe('/shop/?material=Organic%20cotton');
  });

  it('round-trips through the parser', () => {
    const search = {sort: 'price-asc' as const, color: ['Stone', 'Black'], maxPrice: 200};
    const url = new URL(listingHref('/shop/', search), 'https://x.test');
    expect(parseListingSearch(url.searchParams)).toEqual(search);
  });
});

describe('toApiQuery', () => {
  it('maps the name sort to featured and joins lists', () => {
    expect(toApiQuery({sort: 'name', color: ['Stone', 'Black']})).toEqual({sort: 'featured', color: 'Stone,Black'});
  });

  it('lets the route scope override the URL category and adds base', () => {
    expect(toApiQuery({category: ['Dresses'], maxPrice: 90}, {dept: 'women', category: 'shirts'}, 'category')).toEqual({
      sort: 'featured',
      dept: 'women',
      category: 'shirts',
      maxPrice: '90',
      base: 'category',
    });
  });
});

describe('sortItems and priceCeiling', () => {
  const items = [{name: 'Ulla'}, {name: 'Anke'}, {name: 'Mira'}] as Product[];

  it('sorts by name only for the name sort, without mutating', () => {
    expect(sortItems(items, 'name').map(p => p.name)).toEqual(['Anke', 'Mira', 'Ulla']);
    expect(sortItems(items, 'featured')).toBe(items);
    expect(items[0]!.name).toBe('Ulla');
  });

  it('rounds the ceiling up to the 5 step, at least 5', () => {
    expect(priceCeiling(0)).toBe(5);
    expect(priceCeiling(undefined)).toBe(5);
    expect(priceCeiling(148)).toBe(150);
    expect(priceCeiling(150)).toBe(150);
  });
});

describe('facetCounts', () => {
  it('counts base products per facet value (variants for colour and size)', () => {
    const p = (category: string, material: string, variants: [string, string][]) =>
      ({category, material, brand: 'VAREL', variants: variants.map(([color, size]) => ({color, size}))}) as unknown as Product;
    const items = [p('Shirts', 'Linen', [['Stone', 'S'], ['Stone', 'M']]), p('Shirts', 'Wool', [['Black', 'M']]), p('Dresses', 'Linen', [])];
    expect(
      facetCounts(items, [
        {key: 'category', label: 'Category', values: ['Dresses', 'Shirts']},
        {key: 'color', label: 'Colour', values: ['Black', 'Stone']},
        {key: 'size', label: 'Size', values: ['S', 'M']},
        {key: 'material', label: 'Material', values: ['Linen', 'Wool']},
      ])
    ).toEqual({
      category: {Dresses: 1, Shirts: 2},
      color: {Black: 1, Stone: 1},
      size: {S: 1, M: 2},
      material: {Linen: 2, Wool: 1},
    });
  });
});
