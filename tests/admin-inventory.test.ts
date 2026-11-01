/* Inventory admin (WP-18): validators and the pure helpers behind GET/PATCH/POST /manage/inventory,
   plus the client-side CSV and bulk dialog rules. */
import {describe, expect, it} from 'vitest';

import {amountValid, nextCount, variantName} from '../src/portal/screens/inventory/actions';
import {csvCell, csvText} from '../src/portal/screens/inventory/csv';
import {inventoryStateOf, validateInventorySearch} from '../src/portal/queries/inventory';
import {
  adjustBody,
  afterWhere,
  bulkBody,
  inventoryCursor,
  inventoryQuery,
  searchWhere,
  searchWords,
  skuParam,
  stateWhere,
  variantState,
} from '../src/server/routes/admin/inventory';
import {encodeCursor} from '../src/server/lib/http';

describe('inventory list query', () => {
  it('accepts a comma list of states and drops repeats', () => {
    expect(inventoryQuery.parse({state: 'low,out,low'}).state).toEqual(['low', 'out']);
    expect(inventoryQuery.parse({}).state).toEqual([]);
  });

  it('refuses unknown states and long searches', () => {
    const bad = inventoryQuery.safeParse({state: 'foo'});
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Use in, low, out');
    expect(inventoryQuery.safeParse({q: 'x'.repeat(201)}).success).toBe(false);
  });

  it('splits search words, at most 8, each cut to 64 characters', () => {
    expect(searchWords('  linen   shirt ')).toEqual(['linen', 'shirt']);
    expect(searchWords('a b c d e f g h i j')).toHaveLength(8);
    expect(searchWords('x'.repeat(100))[0]).toHaveLength(64);
    expect(searchWhere([])).toEqual({});
    expect(searchWhere(['m']).AND).toHaveLength(1);
  });

  it('turns stock states into inventory ranges', () => {
    expect(stateWhere(['low'], 6)).toEqual({inventory: {gte: 1, lte: 6}});
    expect(stateWhere(['out'], 6)).toEqual({inventory: {lte: 0}});
    expect(stateWhere(['in', 'out'], 6)).toEqual({OR: [{inventory: {gt: 6}}, {inventory: {lte: 0}}]});
    expect(stateWhere([], 6)).toEqual({});
    expect(stateWhere(['in', 'low', 'out'], 6)).toEqual({});
  });

  it('labels a count by the threshold', () => {
    expect([0, 1, 6, 7].map(n => variantState(n, 6))).toEqual(['out', 'low', 'low', 'in']);
    expect([0, 3, 4].map(n => variantState(n, 3))).toEqual(['out', 'low', 'in']);
    expect(inventoryStateOf(7)).toBe('in');
  });

  it('round-trips the 4-part cursor and ignores malformed ones', () => {
    const c = encodeCursor([2, 'linen-shirt', 3, 'VRL-LS-BLA-M']);
    expect(inventoryCursor(c)).toEqual([2, 'linen-shirt', 3, 'VRL-LS-BLA-M']);
    expect(inventoryCursor('not-a-cursor')).toBeNull();
    expect(inventoryCursor(encodeCursor(['x', 'a', 1, 'b']))).toBeNull();
    expect(inventoryCursor(undefined)).toBeNull();
    expect(afterWhere(null)).toEqual({});
    expect(afterWhere([1, 'p', 2, 'v']).OR).toHaveLength(4);
  });

  it('screen search: keeps q and known states, drops the old page number', () => {
    expect(validateInventorySearch({q: 'linen', state: 'low,out,nope', page: '3'})).toEqual({q: 'linen', state: ['low', 'out']});
  });
});

describe('inventory writes', () => {
  it('PATCH takes exactly one of inventory or adjust', () => {
    expect(adjustBody.safeParse({inventory: 3}).success).toBe(true);
    expect(adjustBody.safeParse({adjust: -3}).success).toBe(true);
    const both = adjustBody.safeParse({inventory: 3, adjust: 1});
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.message).toBe('Send either inventory or adjust');
    expect(adjustBody.safeParse({}).success).toBe(false);
  });

  it('PATCH counts are whole numbers from 0 to 1 000 000', () => {
    for (const inventory of [-1, 1.5, 1_000_001]) expect(adjustBody.safeParse({inventory}).success).toBe(false);
    expect(adjustBody.safeParse({inventory: '12'}).data).toEqual({inventory: 12});
    expect(adjustBody.safeParse({adjust: 0.5}).success).toBe(false);
  });

  it('bulk takes 1 to 500 updates', () => {
    expect(bulkBody.safeParse({updates: []}).success).toBe(false);
    const many = Array.from({length: 501}, (_, i) => ({variantId: `V${i}`, inventory: 1}));
    expect(bulkBody.safeParse({updates: many}).success).toBe(false);
    expect(bulkBody.safeParse({updates: [{variantId: ' ', inventory: 1}]}).success).toBe(false);
    expect(bulkBody.safeParse({updates: [{variantId: 'A', inventory: 2}]}).success).toBe(true);
  });

  it('SKUs in the path: the SKU alphabet or 404', () => {
    expect(skuParam('VRL-LS-BLA-M')).toBe('VRL-LS-BLA-M');
    expect(skuParam('VRL%2E1')).toBe('VRL.1');
    for (const bad of ['-x', 'a b', 'x'.repeat(65), '%E0%A4%A']) expect(() => skuParam(bad)).toThrow('We cannot find that variant');
  });
});

describe('inventory screen helpers', () => {
  it('bulk dialog: set ≥ 0, adjust ≠ 0, floors at zero', () => {
    expect(amountValid('set', '0')).toBe(true);
    expect(amountValid('set', '')).toBe(false);
    expect(amountValid('adjust', '0')).toBe(false);
    expect(amountValid('adjust', '-5')).toBe(true);
    expect(amountValid('adjust', '-')).toBe(false);
    expect(amountValid('zero', '')).toBe(true);
    expect(nextCount('adjust', -10, 4)).toBe(0);
    expect(nextCount('set', 9, 4)).toBe(9);
    expect(nextCount('zero', 9, 4)).toBe(0);
  });

  it('names a variant from its colour, size and options', () => {
    expect(variantName({color: 'Stone', size: 'M', options: {Fabric: 'Linen'}})).toBe('Stone · M · Linen');
    expect(variantName({color: null, size: null, options: {}})).toBe('Default');
  });

  it('CSV quotes, escapes and guards formulas', () => {
    expect(csvCell('=SUM(1)')).toBe("'=SUM(1)");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvText(['SKU', 'Inventory'], [['A', 3]])).toBe('SKU,Inventory\r\nA,3');
  });
});
