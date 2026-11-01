import {describe, expect, it} from 'vitest';

import {deriveSelection, type ProductT} from '../src/components/product/useVariantSelection';
import {validSlug} from '../src/server/routes/product';
import type {Product, Variant} from '../src/lib/types/catalog';

/** WP-03: the PDP variant selection (port of VAREL useVariantSelection) and the slug rule of routes/product.ts. */

const t: ProductT = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

const v = (id: string, color: string | null, size: string | null, inventory: number | null, options: Record<string, string> = {}, price = 100): Variant =>
  ({id, color, colorLabel: color, size, swatch: null, options, price, inventory}) as Variant;

type P = Parameters<typeof deriveSelection>[0];
const product = (variants: Variant[], extra: Partial<P> = {}): P => {
  const colors = [...new Set(variants.map(x => x.color).filter((c): c is string => !!c))];
  return {
    type: 'physical',
    allowBackorder: false,
    options: [],
    swatches: colors.map(name => ({name, hex: '#000', label: name})),
    sizes: [...new Set(variants.map(x => x.size).filter((s): s is string => !!s))],
    variants,
    ...extra,
  } as P;
};

const shirt = product([
  v('ST-S', 'Stone', 'S', 0),
  v('ST-M', 'Stone', 'M', 5),
  v('ST-L', 'Stone', 'L', 2),
  v('BL-M', 'Black', 'M', 9),
]);

describe('deriveSelection', () => {
  it('defaults to the first colour and the first size in stock', () => {
    const s = deriveSelection(shirt, {}, {}, t);
    expect(s.color).toBe('Stone');
    expect(s.size).toBe('M');
    expect(s.soldOutSizes).toEqual(['S']);
    expect(s.variant?.id).toBe('ST-M');
    expect(s.stockTone).toBe('in');
    expect(s.qtyMax).toBe(5);
  });

  it('honours the URL colour and size, and falls back on unknown ones', () => {
    expect(deriveSelection(shirt, {color: 'Black', size: 'M'}, {}, t).variant?.id).toBe('BL-M');
    const odd = deriveSelection(shirt, {color: 'Purple', size: 'XXL'}, {}, t);
    expect(odd.color).toBe('Stone');
    expect(odd.size).toBe('M');
  });

  it('without custom options every size shows, even when a colour lacks it (missing = sold out)', () => {
    const s = deriveSelection(shirt, {color: 'Black'}, {}, t);
    expect(s.sizes).toEqual(['S', 'M', 'L']);
    expect(s.soldOutSizes).toEqual(['S', 'L']);
  });

  it('low stock at 3 or fewer, with the count', () => {
    const s = deriveSelection(shirt, {color: 'Stone', size: 'L'}, {}, t);
    expect(s.stockTone).toBe('low');
    expect(s.stockLine).toBe('stock.lowLeft:{"count":2}');
  });

  it('a sold-out size is out, and a null inventory on a physical variant counts as sold out', () => {
    const out = deriveSelection(shirt, {color: 'Stone', size: 'S'}, {}, t);
    expect(out.soldOut).toBe(true);
    expect(out.stockTone).toBe('out');
    expect(out.stockLine).toBe('stock.soldOutSize');
    expect(out.qtyMax).toBe(1);
    const unknown = deriveSelection(product([v('X', null, 'M', null)]), {}, {}, t);
    expect(unknown.soldOut).toBe(true);
  });

  it('backorder: nothing sold out, made to order, quantity up to 9', () => {
    const p = product([v('A', 'Oat', 'S', 0), v('B', 'Oat', 'M', 0)], {allowBackorder: true});
    const s = deriveSelection(p, {}, {}, t);
    expect(s.soldOutSizes).toEqual([]);
    expect(s.size).toBe('S');
    expect(s.soldOut).toBe(false);
    expect(s.stockTone).toBe('in');
    expect(s.stockLine).toBe('stock.backorder');
    expect(s.qtyMax).toBe(9);
  });

  it('digital products are never sold out', () => {
    const s = deriveSelection(product([v('D', null, null, 0)], {type: 'digital'}), {}, {}, t);
    expect(s.digital).toBe(true);
    expect(s.soldOut).toBe(false);
    expect(s.stockTone).toBe('digital');
    expect(s.stockLine).toBe('stock.instantDownload');
    expect(s.size).toBeNull();
  });

  it('a product without variants: physical is sold out', () => {
    const s = deriveSelection(product([]), {}, {}, t);
    expect(s.variant).toBeUndefined();
    expect(s.soldOut).toBe(true);
  });

  it('custom options: the default picks a value that exists for the colour; sizes follow the combination', () => {
    const p = product(
      [
        v('C-1', 'Black', 'S', 3, {Fabric: 'Cork'}),
        v('C-2', 'Black', 'M', 0, {Fabric: 'Cork'}),
        v('C-3', 'Stone', 'L', 4, {Fabric: 'Canvas'}),
      ],
      {options: [{name: 'Fabric', values: ['Canvas', 'Cork']}]}
    );
    const s = deriveSelection(p, {}, {}, t);
    expect(s.color).toBe('Black');
    expect(s.custom).toEqual([{name: 'Fabric', values: ['Canvas', 'Cork'], value: 'Cork', soldOut: ['Canvas']}]);
    expect(s.sizes).toEqual(['S', 'M']);
    expect(s.soldOutSizes).toEqual(['M']);
    expect(s.variant?.id).toBe('C-1');
    const canvas = deriveSelection(p, {color: 'Stone'}, {Fabric: 'Canvas'}, t);
    expect(canvas.sizes).toEqual(['L']);
    expect(canvas.variant?.id).toBe('C-3');
  });
});

describe('validSlug', () => {
  it('accepts lowercase slugs up to 120 characters only', () => {
    expect(validSlug('forma-overshirt')).toBe('forma-overshirt');
    expect(validSlug(' forma ')).toBe('forma');
    for (const bad of ['', 'A B', 'Forma', '-x', 'x'.repeat(121), 'a%20b', 'a/b', undefined]) expect(validSlug(bad)).toBeNull();
    expect(validSlug('x'.repeat(120))).toBe('x'.repeat(120));
  });
});

// Keep the Product import used (the fixture type is derived from it).
export type _P = Product;
