/* Products admin (WP-17): input schemas, image sources, list helpers and copy naming. No database. */
import {describe, expect, it} from 'vitest';

import {createSchema, patchSchema} from '../src/server/routes/admin/products';
import {
  adminProductRow,
  copyBase,
  copyCandidates,
  cursorArity,
  cursorOf,
  firstFree,
  imageKey,
  likeEscape,
  type ListRow,
  parseImageSrc,
  searchWords,
  withSuffix,
} from '../src/server/routes/admin/products-shared';

const FILE = 'file_0123456789abcdefghijklmnop';

const valid = () => ({
  name: 'Linen Camp Shirt',
  brand: 'VAREL',
  dept: 'Women',
  category: 'Shirts',
  type: 'physical',
  price: 120,
  sku: 'vrl-lcs',
  variants: [{id: 'vrl-lcs-s', color: null, size: 'S', swatch: null, price: 120, inventory: 3}],
});

const fieldsOf = (r: {success: boolean; error?: {issues: {path: PropertyKey[]; message: string}[]}}) =>
  Object.fromEntries((r.error?.issues ?? []).map(i => [i.path.join('.'), i.message]));

describe('create schema', () => {
  it('fills the defaults and normalises SKUs and tags', () => {
    const r = createSchema.parse({...valid(), tags: ['Linen', 'linen', 'Summer'], price: '120.555'});
    expect(r.status).toBeUndefined(); // the route writes draft
    expect(r.sku).toBe('VRL-LCS');
    expect(r.variants[0]?.id).toBe('VRL-LCS-S');
    expect(r.variants[0]?.options).toEqual({});
    expect(r.tags).toEqual(['linen', 'summer']);
    expect(r.price).toBe(120.56);
  });

  it('answers each limit with its message', () => {
    const bad = createSchema.safeParse({
      ...valid(),
      name: 'n'.repeat(161),
      sku: '-bad',
      tags: Array.from({length: 31}, (_, i) => `t${i}`),
      images: Array.from({length: 21}, () => ({src: 'https://images.example.com/a.jpg'})),
      options: [
        {kind: 'size', name: 'Size', values: ['S']},
        {kind: 'custom', name: 'size', values: ['x']},
      ],
    });
    const f = fieldsOf(bad);
    expect(f.name).toBe('Keep a name under 160 characters');
    expect(f.sku).toBe('Use letters, numbers, dots, dashes and underscores');
    expect(f.tags).toBe('Use 30 tags or fewer');
    expect(f.images).toBe('Use 20 images or fewer');
    expect(f.options).toBe('Option names must be different');
  });

  it('checks variants: count, swatch, stock, price', () => {
    expect(fieldsOf(createSchema.safeParse({...valid(), variants: []})).variants).toBe('Add at least one variant');
    const many = Array.from({length: 201}, (_, i) => ({id: `V${i}`, color: null, size: null, swatch: null, price: 1, inventory: 0}));
    expect(fieldsOf(createSchema.safeParse({...valid(), variants: many})).variants).toBe('Use 200 variants or fewer');
    const f = fieldsOf(
      createSchema.safeParse({...valid(), variants: [{id: 'A', color: null, size: null, swatch: 'red', price: 2_000_000, inventory: -1}]})
    );
    expect(f['variants.0.swatch']).toBe('Use a hex colour such as #CFC8BE');
    expect(f['variants.0.inventory']).toBe('Use zero or more');
    expect(f['variants.0.price']).toBe('Keep a price under $1,000,000');
    expect(createSchema.parse({...valid(), variants: [{id: 'A', color: null, size: null, swatch: '', price: 1, inventory: 1}]}).variants[0]?.swatch).toBeNull();
  });

  it('accepts https images and uploaded files only', () => {
    expect(createSchema.safeParse({...valid(), images: [{src: `/__platform/files/${FILE}/shirt.webp`}]}).success).toBe(true);
    const f = fieldsOf(createSchema.safeParse({...valid(), images: [{src: '/api/media/x.jpg'}, {src: 'http://a.test/x.jpg'}]}));
    expect(f['images.0.src']).toBe('Use an https URL or an uploaded image');
    expect(f['images.1.src']).toBe('Use an https URL or an uploaded image');
  });

  it('refuses a malformed slug and download name', () => {
    const f = fieldsOf(createSchema.safeParse({...valid(), id: 'Bad Slug', download: 'my file.pdf'}));
    expect(f.id).toBe('Use lowercase letters, numbers and single dashes');
    expect(f.download).toBe('Use a file name such as varel-care-guide.pdf');
    expect(createSchema.parse({...valid(), download: ''}).download).toBeNull();
  });

  it('patch accepts one field alone', () => {
    expect(patchSchema.parse({status: 'archived'})).toEqual({status: 'archived'});
    expect(patchSchema.safeParse({status: 'gone'}).success).toBe(false);
  });
});

describe('image sources', () => {
  it('reads https links and platform links', () => {
    expect(parseImageSrc('https://images.unsplash.com/photo-1')).toEqual({kind: 'https'});
    expect(parseImageSrc(`/__platform/files/${FILE}/a.webp`)).toEqual({kind: 'file', fileId: FILE});
    expect(parseImageSrc('/api/media/a.jpg')).toBeNull();
    expect(parseImageSrc('http://images.test/a.jpg')).toBeNull();
    expect(parseImageSrc('javascript:alert(1)')).toBeNull();
    expect(parseImageSrc(`/__platform/files/${FILE}/a.webp?x=1`)).toBeNull();
  });

  it('keys an uploaded image by its file id, others by a src prefix', () => {
    expect(imageKey(`/__platform/files/${FILE}/a.webp`)).toBe(FILE);
    expect(imageKey(`https://a.test/${'x'.repeat(400)}`).length).toBeLessThanOrEqual(200);
  });
});

describe('list helpers', () => {
  const row = (p: Partial<ListRow> = {}): ListRow => ({
    id: 'shirt',
    name: 'Shirt',
    sku: 'VRL-S',
    type: 'physical',
    status: 'published',
    price_cents: 12000,
    compare_at_cents: null,
    updated_at: new Date('2026-11-01T10:00:00Z'),
    created_at: new Date('2026-10-01T10:00:00Z'),
    position: 3,
    dept: 'Women',
    category: 'Shirts',
    variant_count: 2,
    inventory: 4,
    stock: 'low',
    stock_rank: 1,
    src: null,
    credit: null,
    credit_href: null,
    ...p,
  });

  it('serialises a row in major units', () => {
    const r = adminProductRow(row({compare_at_cents: 15000, src: 'https://a.test/x.jpg'}));
    expect(r).toMatchObject({price: 120, compareAt: 150, inventory: 4, stock: 'low', updatedAt: '2026-11-01T10:00:00.000Z'});
    expect(r.image).toEqual({src: 'https://a.test/x.jpg', credit: '', creditHref: ''});
    expect(adminProductRow(row({type: 'digital', inventory: 0, stock: 'digital'})).inventory).toBeNull();
    expect(adminProductRow(row()).image).toBeNull();
  });

  it('builds cursors per sort (inventory: digital last, arity 3)', () => {
    expect(cursorOf('name', row({name: 'Linen Shirt'}))).toEqual(['linen shirt', 'shirt']);
    expect(cursorOf('price', row())).toEqual([12000, 'shirt']);
    expect(cursorOf('inventory', row())).toEqual([0, 4, 'shirt']);
    expect(cursorOf('inventory', row({inventory: null}))).toEqual([1, 0, 'shirt']);
    expect(cursorArity('inventory')).toBe(3);
    expect(cursorArity('updatedAt')).toBe(2);
  });

  it('escapes LIKE input and keeps eight words', () => {
    expect(likeEscape('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(searchWords('  a b  c d e f g h i j ')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});

describe('copy naming', () => {
  it('picks -copy, then -copy-2', () => {
    const base = copyBase('linen-shirt', '-copy', 120);
    expect(base).toBe('linen-shirt-copy');
    expect(firstFree(copyCandidates(base), new Set())).toBe('linen-shirt-copy');
    expect(firstFree(copyCandidates(base), new Set(['linen-shirt-copy']))).toBe('linen-shirt-copy-2');
    expect(() => firstFree(['a'], new Set(['a']))).toThrow(/free name/);
  });

  it('keeps copies within the column lengths', () => {
    const slug = copyBase('a'.repeat(120), '-copy', 120);
    expect(`${slug}-999`.length).toBeLessThanOrEqual(120);
    const sku = copyBase('S'.repeat(64), '-COPY', 64);
    expect(`${sku}-999`.length).toBeLessThanOrEqual(64);
    expect(withSuffix('V'.repeat(64), '-COPY-2')).toHaveLength(64);
    expect(withSuffix('VRL-S-M', '-COPY')).toBe('VRL-S-M-COPY');
  });
});
