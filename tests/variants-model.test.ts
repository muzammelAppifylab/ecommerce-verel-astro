/* Product editor variants model (WP-18): variants built from up to 3 options (colour, size, custom), price
   inherited from the product, generated SKUs. Port of VAREL tests/product-variants.test.ts ("variants from
   options", "options read back from a product", swatches, SKU / price helpers). */
import {describe, expect, it} from 'vitest';

import {bulkValueValid, duplicateSkus, normalValue, title} from '../src/portal/screens/products/VariantsSection';
import {
  build,
  comboKey,
  effectivePrice,
  effectiveSku,
  guessSwatch,
  missingCombos,
  newOption,
  type OptionDef,
  optionsFrom,
  toProductOptions,
  type VariantItem,
  variantSku,
  withValue,
} from '../src/portal/screens/products/variants';

const row = (color: string | null, size: string | null, p: Partial<VariantItem> = {}): VariantItem => ({
  uid: `${color}-${size}-${JSON.stringify(p.options ?? {})}`,
  id: '',
  color,
  size,
  swatch: color ? '#000000' : null,
  options: {},
  price: '',
  inventory: '0',
  ...p,
});
const def = (kind: OptionDef['kind'], values: string[], name?: string): OptionDef => ({
  ...newOption(kind, name),
  values: values.map(n => (kind === 'color' ? {name: n, hex: '#111111'} : {name: n})),
});
const none = new Set<string>();
const labels = (rows: VariantItem[], defs: OptionDef[]) => rows.map(v => comboKey(v, defs));

describe('variants from options', () => {
  it('builds one variant per combination, in option order', () => {
    const defs = [def('color', ['Black', 'Stone']), def('size', ['S', 'M'])];
    expect(labels(build(defs, [], none), defs)).toEqual(['Black|S', 'Black|M', 'Stone|S', 'Stone|M']);
  });

  it('custom options multiply like colour and size, stored by option name', () => {
    const defs = [def('color', ['Brown', 'Black']), def('custom', ['Acrylic', 'Canvas', 'Cork'], 'Fabric')];
    const out = build(defs, [], none);
    expect(out.length).toBe(6);
    expect(out[0]!.options).toEqual({Fabric: 'Acrylic'});
    expect(out[0]!.color).toBe('Brown');
  });

  it('new variants use the product price (empty) and start at zero stock', () => {
    const out = build([def('size', ['S', 'M'])], [], none);
    expect(out.every(v => v.price === '' && v.inventory === '0' && v.id === '')).toBe(true);
  });

  it('keeps price, stock and SKU of rows that already exist', () => {
    const defs = [def('color', ['Black']), def('size', ['S', 'M'])];
    const out = build(defs, [row('Black', 'S', {price: '90', inventory: '7', id: 'KEEP-1'})], none);
    expect([out[0]!.price, out[0]!.inventory, out[0]!.id]).toEqual(['90', '7', 'KEEP-1']);
    expect(out[1]!.inventory).toBe('0');
  });

  it('a new option on existing rows: they take its first value and keep their stock', () => {
    const fabric = def('custom', ['Canvas', 'Cork'], 'Fabric');
    const prev = [row('Black', null, {inventory: '4'})].map(v => withValue(v, fabric, 'Canvas'));
    const out = build([def('color', ['Black']), fabric], prev, none);
    expect(out.find(v => v.options.Fabric === 'Canvas')?.inventory).toBe('4');
    expect(out.find(v => v.options.Fabric === 'Cork')?.inventory).toBe('0');
  });

  it('no options means one default variant that keeps its stock', () => {
    const out = build([], [row('Black', 'S', {inventory: '3'})], none);
    expect(out.length).toBe(1);
    expect([out[0]!.color, out[0]!.size, out[0]!.inventory]).toEqual([null, null, '3']);
  });

  it('a lone default row hands its price to the generated rows', () => {
    const out = build([def('size', ['S', 'M'])], [row(null, null, {price: '55'})], none);
    expect(out.map(v => v.price)).toEqual(['55', '55']);
  });

  it('removed combinations stay removed', () => {
    const defs = [def('color', ['Black']), def('size', ['S', 'M'])];
    expect(build(defs, [], new Set(['Black|M'])).map(v => v.size)).toEqual(['S']);
  });

  it('renaming a custom option moves the values to the new name', () => {
    const fabric = def('custom', ['Canvas'], 'Fabric');
    const v = withValue(withValue(row(null, null), fabric, 'Canvas'), fabric, null);
    expect(withValue(v, {kind: 'custom', name: 'Material'}, 'Canvas').options).toEqual({Material: 'Canvas'});
  });
});

describe('options read back from a product', () => {
  it('older products: colour, size and custom names come from the rows', () => {
    const defs = optionsFrom([row('Black', 'S', {options: {Fabric: 'Cork'}}), row('Stone', 'S', {options: {Fabric: 'Cork'}})]);
    expect(defs.map(d => [d.kind, d.name])).toEqual([
      ['color', 'Colour'],
      ['size', 'Size'],
      ['custom', 'Fabric'],
    ]);
  });

  it('the saved list sets names, order and value order', () => {
    const rows = [row(null, 'M', {options: {Fabric: 'Cork'}}), row(null, 'S', {options: {Fabric: 'Canvas'}})];
    const defs = optionsFrom(rows, [
      {kind: 'custom', name: 'Fabric', values: ['Canvas', 'Cork']},
      {kind: 'size', name: 'Size', values: ['S', 'M']},
    ]);
    expect(defs.map(d => d.name)).toEqual(['Fabric', 'Size']);
    expect(defs[0]!.values.map(v => v.name)).toEqual(['Canvas', 'Cork']);
    expect(defs[1]!.values.map(v => v.name)).toEqual(['S', 'M']);
  });

  it('keeps the size order when the first colour is missing a size', () => {
    const saved = ['S', 'M', 'L'].map(sz => row('Black', sz)).concat(['XS', 'S', 'M', 'L'].map(sz => row('Stone', sz)));
    expect(optionsFrom(saved).find(d => d.kind === 'size')!.values.map(v => v.name)).toEqual(['XS', 'S', 'M', 'L']);
  });

  it('a removed variant stays removed after reopening and changing options', () => {
    const saved = ['S', 'M'].map(sz => row('Black', sz)).concat(['XS', 'S', 'M'].map(sz => row('Stone', sz)));
    const defs = optionsFrom(saved);
    const removed = missingCombos(defs, saved);
    expect([...removed]).toEqual(['Black|XS']);
    expect(build(defs, saved, removed).length).toBe(5);
  });

  it('saves only named options that have values', () => {
    const out = toProductOptions([def('color', ['Black']), def('custom', [], 'Fit'), def('custom', ['Long'], ' ')]);
    expect(out).toEqual([{kind: 'color', name: 'Colour', values: ['Black']}]);
  });
});

describe('SKUs, prices and swatches', () => {
  it('variants without a price use the product price', () => {
    expect(effectivePrice({price: ''}, '120')).toBe('120');
    expect(effectivePrice({price: '135'}, '120')).toBe('135');
  });

  it('custom option values go into the generated SKU', () => {
    expect(effectiveSku(row('Black', 'M', {options: {Fabric: 'Canvas'}}), 'VRL-X')).toBe('VRL-X-BLA-M-CANV');
    expect(effectiveSku(row('Black', 'M', {id: 'OWN-1'}), 'VRL-X')).toBe('OWN-1');
  });

  it('generates SKU parts: "One size" → OS, an empty base → SKU', () => {
    expect(variantSku('', 'Stone', 'One size')).toBe('SKU-STO-OS');
    expect(variantSku('VRL', 'Éclair', 'xl')).toBe('VRL-ECL-XL');
  });

  it('flags variants that would save with the same SKU (case-insensitive)', () => {
    const rows = [row('Black', 'S', {id: 'vrl-x-bla-s', uid: 'a'}), row('Black', 'S', {uid: 'b'}), row('Black', 'M', {uid: 'c'})];
    expect([...duplicateSkus(rows, 'VRL-X')].sort()).toEqual(['a', 'b']);
  });

  it('guesses a swatch from colour words', () => {
    expect(guessSwatch('Moss green')).not.toBe('#B3B3B3');
    expect(guessSwatch('Zebra')).toBe('#B3B3B3');
    expect(guessSwatch('Camel')).toBe('#B39271');
  });
});

describe('option editor text rules', () => {
  it('title-cases names and upper-cases short sizes', () => {
    expect(title('  moss   green ')).toBe('Moss green');
    expect(normalValue({kind: 'size'}, 'xl')).toBe('XL');
    expect(normalValue({kind: 'size'}, 'one size')).toBe('One size');
    expect(normalValue({kind: 'color'}, 'stone')).toBe('Stone');
  });

  it('bulk values: money, counts, signed adjustments', () => {
    expect(bulkValueValid('money', '12.5')).toBe(true);
    expect(bulkValueValid('money', '12.555')).toBe(false);
    expect(bulkValueValid('money', '')).toBe(false);
    expect(bulkValueValid('count', '0')).toBe(true);
    expect(bulkValueValid('count', '-1')).toBe(false);
    expect(bulkValueValid('signed', '-2')).toBe(true);
    expect(bulkValueValid('signed', '+5')).toBe(true);
    expect(bulkValueValid('signed', '0')).toBe(false);
  });
});
