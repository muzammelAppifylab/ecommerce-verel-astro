/* Product editor model (port of VAREL tests/product-variants.test.ts "product form"): price inherited from the product,
   generated SKUs, profit, the form → API input, and the client limits aligned with the server's. */
import {describe, expect, it} from 'vitest';

import {
  baseSkuFromName,
  defaultVariant,
  effectivePrice,
  effectiveSku,
  emptyForm,
  formFromProduct,
  profitOf,
  slugFromName,
  snapshot,
  toInput,
  validate,
  valueAt,
  type VariantItem,
} from '../src/portal/screens/products/form';
import {newOption, type OptionDef} from '../src/portal/screens/products/variants';
import type {AdminProduct} from '../src/lib/types/admin/catalog';

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

describe('product form', () => {
  const base = () => ({...emptyForm(), name: 'X', id: 'x', sku: 'VRL-X', dept: 'Women', category: 'Shirts', price: '120'});

  it('variants without a price use the product price on save', () => {
    const f = {...base(), variants: [row('Black', 'S'), row('Black', 'M', {price: '135'})]};
    expect(validate(f)).toEqual({});
    expect(toInput(f, {includeId: false}).variants.map(v => v.price)).toEqual([120, 135]);
    expect(effectivePrice({price: ''}, '120')).toBe('120');
  });

  it('custom option values go into the SKU and the input', () => {
    const v = row('Black', 'M', {options: {Fabric: 'Canvas'}});
    expect(effectiveSku(v, 'VRL-X')).toBe('VRL-X-BLA-M-CANV');
    const input = toInput({...base(), variants: [v], options: [def('color', ['Black']), def('size', ['M']), def('custom', ['Canvas'], 'Fabric')]}, {includeId: false});
    expect(input.variants[0]?.options).toEqual({Fabric: 'Canvas'});
    expect(input.options?.map(o => o.name)).toEqual(['Colour', 'Size', 'Fabric']);
  });

  it('a new product starts with one default variant saved with the base SKU and price', () => {
    const f = {...base(), variants: [defaultVariant('', '4')]};
    expect(validate(f)).toEqual({});
    const input = toInput(f, {includeId: true});
    expect(input.id).toBe('x');
    expect(input.variants).toEqual([{id: 'VRL-X', color: null, size: null, swatch: null, options: {}, price: 120, inventory: 4}]);
  });

  it('flags two variants that would save with the same SKU', () => {
    const f = {...base(), variants: [row('Black', 'S', {id: 'VRL-X-BLA-S'}), row('Black', 'S', {uid: 'dup'})]};
    expect(validate(f)['variants.1.id']).toBe('Duplicate SKU');
  });

  it('sends cost, weight and packed size; digital products drop the shipping numbers and options', () => {
    const f = {...base(), costPerItem: '40', weight: '0.8', packageLength: '30', packageWidth: '20', packageHeight: '5', options: [def('size', ['M'])]};
    const p = toInput(f, {includeId: false});
    expect([p.costPerItem, p.weight, p.packageLength, p.packageWidth, p.packageHeight]).toEqual([40, 0.8, 30, 20, 5]);
    const d = toInput({...f, type: 'digital', download: 'a.pdf'}, {includeId: false});
    expect(d.weight).toBeNull();
    expect(d.options).toEqual([]);
    expect(d.allowBackorder).toBe(false);
    expect(d.variants).toEqual([{id: 'VRL-X', color: null, size: null, swatch: null, price: 120, inventory: null}]);
  });

  it('works out profit and margin', () => {
    expect(profitOf('100', '40')).toEqual({profit: 60, margin: 60});
    expect(profitOf('100', '')).toBeNull();
    expect(profitOf('100', '130')?.profit).toBe(-30);
  });

  it('builds base SKUs and slugs from the name', () => {
    expect(baseSkuFromName('Linen Camp Shirt')).toBe('VRL-LCS');
    expect(baseSkuFromName('Tote')).toBe('VRL-TOT');
    expect(baseSkuFromName('')).toBe('');
    expect(slugFromName('Linen Camp Shirt!')).toBe('linen-camp-shirt');
    expect(slugFromName('a'.repeat(130)).length).toBe(120);
  });

  it('mirrors the server limits and rules', () => {
    expect(validate({...base(), name: 'n'.repeat(161)}).name).toMatch(/160/);
    expect(validate({...base(), name: 'n'.repeat(160)}).name).toBeUndefined();
    expect(validate({...base(), sku: 'VRL.X_1'}).sku).toBeUndefined();
    expect(validate({...base(), sku: '-VRL'}).sku).toBeDefined();
    expect(validate({...base(), short: 's'.repeat(301)}).short).toBeDefined();
    expect(validate({...base(), compareAt: '100'}).compareAt).toBe('Compare-at must be higher than the price');
    expect(validate({...base(), compareAt: '150'}).compareAt).toBeUndefined();
    expect(validate({...base(), type: 'digital'}).download).toBe('Add the download filename');
    expect(validate({...base(), type: 'digital', download: 'bad name.pdf'}).download).toMatch(/file name/);
    expect(validate({...base(), price: ''}).price).toBe('Price is required');
    expect(validate({...base(), price: '2000000'}).price).toMatch(/1,000,000/);
    expect(validate({...base(), dept: ''}).dept).toBe('Choose a department');
    expect(validate({...base(), variants: [row(null, null, {inventory: '1.5'})]})['variants.0.inventory']).toBe('Whole number, 0 or more');
    expect(validate({...base(), images: [{uid: 'i', src: '', credit: null, creditHref: null, progress: 0.4}]}).images).toBe('Wait for uploads to finish');
  });

  it('reads a product back: equal prices follow the product, images keep their file id', () => {
    const product = {
      id: 'x',
      name: 'X',
      brand: 'VAREL',
      short: '',
      description: '',
      material: '',
      care: null,
      tags: [],
      dept: 'Women',
      category: 'Shirts',
      type: 'physical',
      status: 'draft',
      download: null,
      price: 120,
      compareAt: null,
      sku: 'VRL-X',
      image: null,
      variantCount: 2,
      inventory: 3,
      stock: 'low',
      updatedAt: '2026-11-01T00:00:00.000Z',
      createdAt: '2026-11-01T00:00:00.000Z',
      orderCount: 0,
      images: [
        {id: '2', src: 'https://images.unsplash.com/b', credit: null, creditHref: null, position: 1, fileId: null},
        {id: '1', src: '/__platform/files/file_aaaaaaaaaaaaaaaaaaaaaaaaaa/a.webp', credit: null, creditHref: null, position: 0, fileId: 'file_aaaaaaaaaaaaaaaaaaaaaaaaaa'},
      ],
      variants: [
        {id: 'VRL-X-S', color: null, size: 'S', swatch: null, options: {}, price: 120, inventory: 1},
        {id: 'VRL-X-M', color: null, size: 'M', swatch: null, options: {}, price: 130, inventory: 2},
      ],
      allowBackorder: false,
      featured: false,
      categoryPosition: 0,
      seoTitle: null,
      seoDescription: null,
      costPerItem: null,
      weight: null,
      weightUnit: 'kg',
      packageLength: null,
      packageWidth: null,
      packageHeight: null,
      dimensionUnit: 'cm',
      options: [],
    } satisfies AdminProduct;
    const f = formFromProduct(product);
    expect(f.variants.map(v => v.price)).toEqual(['', '130']);
    expect(f.images.map(i => i.fileId ?? null)).toEqual(['file_aaaaaaaaaaaaaaaaaaaaaaaaaa', null]);
    expect(f.options.map(o => o.name)).toEqual(['Size']);
    expect(toInput(f, {includeId: false}).images[0]).toEqual({
      src: '/__platform/files/file_aaaaaaaaaaaaaaaaaaaaaaaaaa/a.webp',
      credit: null,
      creditHref: null,
      fileId: 'file_aaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('snapshot ignores row ids and upload progress; valueAt reads dotted paths', () => {
    const a = {...base(), variants: [row('Black', 'S')]};
    const b = {...a, variants: [{...a.variants[0]!, uid: 'other'}]};
    expect(snapshot(a)).toBe(snapshot(b));
    expect(snapshot(a)).not.toBe(snapshot({...a, name: 'Y'}));
    expect(valueAt(a, 'variants.0.color')).toBe('"Black"');
    expect(valueAt(a, 'variants.9.color')).toBe('');
  });
});
