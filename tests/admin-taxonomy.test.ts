/* Departments and categories admin (WP-18): validators, ids, slugs, capped counts, reorder ops. */
import {describe, expect, it} from 'vitest';

import {inUseMessage, productsText, reorderOps} from '../src/portal/screens/catalog';
import {nameProblem} from '../src/portal/screens/catalog/NameModal';
import {countText, createBody, idOf, patchBody, slugOr422} from '../src/server/routes/admin/taxonomy';

describe('taxonomy bodies', () => {
  it('names are 1–80 characters after trimming', () => {
    expect(createBody.safeParse({name: '  Shirts '}).data).toEqual({name: 'Shirts'});
    expect(createBody.safeParse({name: ''}).error?.issues[0]?.message).toBe('Enter a name');
    expect(createBody.safeParse({name: 'x'.repeat(81)}).error?.issues[0]?.message).toBe('Keep the name under 80 characters');
    expect(createBody.safeParse({}).success).toBe(false);
  });

  it('positions are whole numbers from 0 to 10 000', () => {
    expect(createBody.safeParse({name: 'A', position: '3'}).data).toEqual({name: 'A', position: 3});
    for (const position of [-1, 10_001, 1.5]) expect(createBody.safeParse({name: 'A', position}).success).toBe(false);
    expect(patchBody.safeParse({}).data).toEqual({});
  });

  it('a name needs a letter or digit for its slug', () => {
    expect(slugOr422('Shoulder Bags')).toBe('shoulder-bags');
    expect(() => slugOr422('!!!')).toThrow();
  });

  it('path ids are positive int4 or 404', () => {
    expect(idOf('12', 'x')).toBe(12);
    for (const bad of ['0', '-1', 'abc', '1.5', '2147483648', '01']) expect(() => idOf(bad, 'nope')).toThrow('nope');
  });

  it('counts past the cap read "100+"', () => {
    expect(countText(1)).toBe('1 product');
    expect(countText(12)).toBe('12 products');
    expect(countText(101)).toBe('100+ products');
  });
});

describe('departments screen helpers', () => {
  it('mirrors the server name rules', () => {
    expect(nameProblem(' ')).toBe('Enter a name');
    expect(nameProblem('x'.repeat(81))).toBe('Keep the name under 80 characters');
    expect(nameProblem('!!!')).toBe('Use at least one letter or number');
    expect(nameProblem('Knitwear')).toBeNull();
  });

  it('reorder renumbers only the items whose position changes', () => {
    const list = [
      {id: 'a', position: 0},
      {id: 'b', position: 1},
      {id: 'c', position: 2},
    ];
    expect(reorderOps(list, 2, -1, 'dept')).toEqual([
      {kind: 'updateDept', id: 'c', position: 1},
      {kind: 'updateDept', id: 'b', position: 2},
    ]);
    expect(reorderOps(list, 0, -1, 'cat')).toEqual([]);
    // Gapped positions (5, 9) are renumbered 0…n−1 as VAREL did.
    expect(reorderOps([{id: 'x', position: 5}, {id: 'y', position: 9}], 0, 1, 'cat')).toEqual([
      {kind: 'updateCat', id: 'y', position: 0},
      {kind: 'updateCat', id: 'x', position: 1},
    ]);
  });

  it('in-use messages', () => {
    const dept = {id: '1', name: 'Women', slug: 'women', position: 0, productCount: 3, categories: []};
    expect(inUseMessage({kind: 'dept', item: dept})).toBe('Women still has 3 products. Move them to another department before deleting it.');
    expect(inUseMessage({kind: 'cat', item: {id: '2', name: 'Shirts', slug: 'shirts', position: 0, productCount: 0}, dept})).toBe(
      'Shirts is still used by products, including archived ones. Move them before deleting it.'
    );
    expect(productsText(101)).toBe('100+ products');
  });
});
