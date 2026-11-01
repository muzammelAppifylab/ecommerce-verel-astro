import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import type {Department, Product, ProductListResponse} from '../../src/lib/types/catalog';
import {app} from '../../src/server/app';
import {invalidateLocaleSettings} from '../../src/server/lib/locale';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/** WP-02 catalog listing routes (`/site-api/taxonomy`, `/site-api/products`) against Postgres. */

type V = {color: string | null; size: string | null; inventory: number};
interface Fixture {
  id: string;
  dept: number;
  cat: number;
  price: number;
  brand?: string;
  material: string;
  position: number;
  categoryPosition?: number;
  featured?: boolean;
  status?: string;
  tags?: string[];
  createdAt: string;
  variants: V[];
}

const PRODUCTS: Fixture[] = [
  {id: 'forma-overshirt', dept: 1, cat: 1, price: 148, material: 'Organic cotton', position: 1, categoryPosition: 2, tags: ['new'], createdAt: '2026-01-01',
    variants: [{color: 'Stone', size: 'S', inventory: 5}, {color: 'Stone', size: 'M', inventory: 5}, {color: 'Black', size: 'M', inventory: 5}]},
  {id: 'linen-shirt', dept: 1, cat: 1, price: 120, brand: 'Atelier', material: 'Linen', position: 2, categoryPosition: 1, createdAt: '2026-03-01',
    variants: [{color: 'White', size: 'S', inventory: 3}]},
  {id: 'wool-dress', dept: 1, cat: 2, price: 260, material: 'Merino wool', position: 3, featured: true, createdAt: '2026-02-01',
    variants: [{color: 'Black', size: 'M', inventory: 2}]},
  {id: 'men-shirt', dept: 2, cat: 3, price: 120, material: 'Linen', position: 4, createdAt: '2026-01-15', variants: [{color: 'Stone', size: 'L', inventory: 4}]},
  {id: 'sold-knit', dept: 2, cat: 4, price: 200, material: 'Wool', position: 5, createdAt: '2026-01-20', variants: [{color: 'Grey', size: 'L', inventory: 0}]},
  {id: 'draft-shirt', dept: 1, cat: 1, price: 90, material: 'Linen', position: 6, status: 'draft', createdAt: '2026-04-01',
    variants: [{color: 'Stone', size: 'S', inventory: 9}]},
];

async function seed() {
  await db.department.createMany({
    data: [
      {id: 1, name: 'Women', slug: 'women', position: 0},
      {id: 2, name: 'Men', slug: 'men', position: 1},
      {id: 3, name: 'Lifestyle', slug: 'lifestyle', position: 2},
    ],
  });
  await db.category.createMany({
    data: [
      {id: 1, name: 'Shirts', slug: 'shirts', position: 0, departmentId: 1},
      {id: 2, name: 'Dresses', slug: 'dresses', position: 1, departmentId: 1},
      {id: 3, name: 'Shirts', slug: 'shirts', position: 0, departmentId: 2},
      {id: 4, name: 'Knitwear', slug: 'knitwear', position: 1, departmentId: 2},
      {id: 5, name: 'Objects', slug: 'objects', position: 0, departmentId: 3},
    ],
  });
  for (const p of PRODUCTS) {
    await db.product.create({
      data: {
        id: p.id,
        name: p.id.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' '),
        brand: p.brand ?? 'VAREL',
        status: p.status ?? 'published',
        priceCents: p.price * 100,
        sku: `SKU-${p.id}`,
        short: `${p.id} short`,
        description: `${p.id} description`,
        material: p.material,
        tags: p.tags ?? [],
        position: p.position,
        categoryPosition: p.categoryPosition ?? 0,
        featured: p.featured ?? false,
        departmentId: p.dept,
        categoryId: p.cat,
        createdAt: new Date(p.createdAt),
        images: {create: [{key: p.id, src: `https://images.example.test/${p.id}.jpg`, position: 0}]},
        variants: {
          create: p.variants.map((v, i) => ({
            id: `${p.id}-${i}`,
            color: v.color,
            size: v.size,
            priceCents: p.price * 100,
            inventory: v.inventory,
            position: i,
          })),
        },
      },
    });
  }
  await db.translation.createMany({
    data: [
      {entity: 'department', entityId: '1', field: 'name', locale: 'da', value: 'Kvinder', sourceHash: 'x'},
      {entity: 'category', entityId: '1', field: 'name', locale: 'da', value: 'Skjorter', sourceHash: 'x'},
      {entity: 'product', entityId: 'forma-overshirt', field: 'material', locale: 'da', value: 'Økologisk bomuld', sourceHash: 'x'},
    ],
  });
}

const guest = () => new Browser(app);
const list = async (query: string, headers: Record<string, string> = {}) => {
  const res = await guest().request('GET', `/site-api/products${query}`, undefined, headers);
  return {...res, body: res.json as unknown as ProductListResponse};
};
const ids = (items: Product[]) => items.map(p => p.id);

describe.skipIf(!DATABASE_URL)('catalog listing (integration, real Postgres)', () => {
  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    invalidateLocaleSettings();
    await seed();
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await db.setting.update({where: {id: 1}, data: {hideSoldOut: false}});
  });

  it('GET /taxonomy: departments and categories in order, published counts, sold-out included', async () => {
    const res = await guest().get('/site-api/taxonomy');
    expect(res.status).toBe(200);
    const depts = res.json as unknown as Department[];
    expect(depts.map(d => d.slug)).toEqual(['women', 'men', 'lifestyle']);
    expect(depts[0]).toMatchObject({name: 'Women', count: 3});
    expect(depts[0]!.categories).toEqual([
      {name: 'Shirts', slug: 'shirts', label: 'Shirts', count: 2},
      {name: 'Dresses', slug: 'dresses', label: 'Dresses', count: 1},
    ]);
    expect(depts[1]).toMatchObject({count: 2});
    expect(depts[2]).toMatchObject({count: 0, categories: [{slug: 'objects', count: 0}]});
    // Without X-Locale the language came from the visitor: not shareable.
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('GET /taxonomy in Danish: translated names, same slugs, public cache keyed on X-Locale', async () => {
    const res = await guest().request('GET', '/site-api/taxonomy', undefined, {'x-locale': 'da'});
    const depts = res.json as unknown as Department[];
    expect(depts[0]).toMatchObject({name: 'Kvinder', label: 'Kvinder', slug: 'women'});
    expect(depts[0]!.categories[0]).toMatchObject({name: 'Skjorter', slug: 'shirts'});
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('vary')).toContain('X-Locale');
  });

  it('GET /taxonomy/sitemap lists every department and category, empty ones too', async () => {
    const res = await guest().get('/site-api/taxonomy/sitemap');
    const paths = (res.json.items as {path: string}[]).map(i => i.path);
    expect(paths).toEqual([
      '/shop/women/', '/shop/women/shirts/', '/shop/women/dresses/',
      '/shop/men/', '/shop/men/shirts/', '/shop/men/knitwear/',
      '/shop/lifestyle/', '/shop/lifestyle/objects/',
    ]);
  });

  it('GET /products: published only, facets from the set, price max', async () => {
    const {status, body, headers} = await list('', {'x-locale': 'en'});
    expect(status).toBe(200);
    expect(ids(body.items)).toEqual(['forma-overshirt', 'linen-shirt', 'wool-dress', 'men-shirt', 'sold-knit']);
    expect(body.total).toBe(5);
    expect(body.priceMax).toBe(260);
    expect(body.facets.map(f => f.key)).toEqual(['category', 'color', 'size', 'material', 'brand']);
    expect(body.facets[0]!.values).toEqual(['Dresses', 'Knitwear', 'Shirts']);
    expect(body.base).toBeUndefined();
    expect(headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('filters: dept, category by name or slug, colour, size, material, brand, tag, price, q, featured', async () => {
    expect(ids((await list('?dept=women')).body.items)).toEqual(['forma-overshirt', 'linen-shirt', 'wool-dress']);
    expect(ids((await list('?dept=women&category=Shirts')).body.items)).toEqual(['linen-shirt', 'forma-overshirt']); // categoryPosition
    expect(ids((await list('?dept=women&category=shirts')).body.items)).toEqual(['linen-shirt', 'forma-overshirt']);
    expect(ids((await list('?color=stone')).body.items)).toEqual(['forma-overshirt', 'men-shirt']);
    expect(ids((await list('?size=L')).body.items)).toEqual(['men-shirt', 'sold-knit']);
    expect(ids((await list('?material=Linen')).body.items)).toEqual(['linen-shirt', 'men-shirt']);
    expect(ids((await list('?material=%C3%98kologisk%20bomuld', {'x-locale': 'da'})).body.items)).toEqual(['forma-overshirt']);
    expect(ids((await list('?brand=Atelier')).body.items)).toEqual(['linen-shirt']);
    expect(ids((await list('?tag=new')).body.items)).toEqual(['forma-overshirt']);
    expect(ids((await list('?maxPrice=130')).body.items)).toEqual(['linen-shirt', 'men-shirt']);
    expect(ids((await list('?q=forma%20overshirt')).body.items)).toEqual(['forma-overshirt']);
    expect(ids((await list('?featured=true')).body.items)).toEqual(['wool-dress']);
    expect(ids((await list('?color=Stone&color=White')).body.items)).toEqual(['forma-overshirt', 'linen-shirt', 'men-shirt']);
  });

  it('facets stay those of the base set when a facet filter is on', async () => {
    const {body} = await list('?color=Stone');
    expect(body.facets.find(f => f.key === 'color')!.values).toEqual(['Black', 'Grey', 'Stone', 'White']);
    expect(body.total).toBe(2);
  });

  it('sorts: newest, price with position tie-break, limit keeps the total', async () => {
    expect(ids((await list('?sort=newest')).body.items)[0]).toBe('linen-shirt');
    expect(ids((await list('?sort=price-asc')).body.items)).toEqual(['linen-shirt', 'men-shirt', 'forma-overshirt', 'sold-knit', 'wool-dress']);
    expect(ids((await list('?sort=price-desc')).body.items)).toEqual(['wool-dress', 'sold-knit', 'forma-overshirt', 'linen-shirt', 'men-shirt']);
    const limited = (await list('?limit=2')).body;
    expect(limited.items).toHaveLength(2);
    expect(limited.total).toBe(5);
  });

  it('hideSoldOut removes a sold-out product from items, total and facets (taxonomy still counts it)', async () => {
    await db.setting.update({where: {id: 1}, data: {hideSoldOut: true}});
    const {body} = await list('');
    expect(ids(body.items)).not.toContain('sold-knit');
    expect(body.total).toBe(4);
    expect(body.facets.find(f => f.key === 'category')!.values).not.toContain('Knitwear');
    const depts = (await guest().get('/site-api/taxonomy')).json as unknown as Department[];
    expect(depts[1]!.count).toBe(2);
  });

  it('base=dept: the panel summary ignores facet filters; base=category keeps the category', async () => {
    const {body} = await list('?dept=women&category=Shirts&color=Stone&base=dept');
    expect(ids(body.items)).toEqual(['forma-overshirt']);
    expect(body.base!.total).toBe(3);
    expect(body.base!.priceMax).toBe(260);
    expect(body.base!.facets.find(f => f.key === 'category')!.values).toEqual(['Dresses', 'Shirts']);
    expect(body.base!.counts.category).toEqual({Dresses: 1, Shirts: 2});
    expect(body.base!.counts.color).toEqual({Black: 2, Stone: 1, White: 1});
    const cat = (await list('?dept=women&category=shirts&base=category')).body;
    expect(cat.base!.total).toBe(2);
    expect(cat.base!.facets.find(f => f.key === 'category')).toBeUndefined(); // one value: dropped
    const empty = (await list('?dept=lifestyle&category=objects&base=category')).body;
    expect(empty.base!.total).toBe(0);
    expect((await list('?base=bogus')).status).toBe(422);
  });

  it('refuses malformed queries with field messages', async () => {
    const cases: [string, string, string][] = [
      ['?maxPrice=-1', 'maxPrice', 'Enter a price of zero or more'],
      ['?maxPrice=abc', 'maxPrice', 'Enter a price'],
      ['?sort=name', 'sort', 'Sort by featured, newest, price-asc or price-desc'],
      ['?sort=bogus', 'sort', 'Sort by featured, newest, price-asc or price-desc'],
      ['?limit=0', 'limit', 'Use a limit of at least 1'],
      ['?limit=101', 'limit', 'Use a limit of 100 or less'],
      ['?limit=1.5', 'limit', 'Use a whole number'],
      ['?featured=yes', 'featured', 'Use featured=true or featured=false'],
      [`?color=${'x'.repeat(61)}`, 'color', 'Keep each value under 60 characters'],
    ];
    for (const [query, field, message] of cases) {
      const res = await list(query);
      expect(res.status, query).toBe(422);
      expect(res.json).toMatchObject({error: 'invalid_input', fields: {[field]: message}});
    }
    expect((await list(`?q=${'a'.repeat(201)}`)).status).toBe(422);
    // More than 20 values: the extra ones are dropped (F3 multiValue), not refused.
    const many = Array.from({length: 21}, (_, i) => `c${i}`).join(',');
    expect((await list(`?color=${many}`)).status).toBe(200);
  });

  it('does not answer product detail paths (routes/product.ts)', async () => {
    const res = await guest().get('/site-api/products/forma-overshirt');
    expect(res.json).not.toHaveProperty('items');
  });
});
