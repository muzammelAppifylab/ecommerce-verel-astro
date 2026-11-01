import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import type {SearchResponse} from '../../src/lib/types/catalog';
import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/** GET /site-api/search (WP-08, port of VAREL worker/routes/search.ts) against Postgres. */
describe.skipIf(!DATABASE_URL)('search (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());

  const day = 24 * 60 * 60 * 1000;
  const photo = {src: 'https://images.example.test/a.jpg', credit: '', creditHref: ''};

  async function product(
    id: string,
    fields: {name: string; departmentId: number; categoryId: number; position: number; inventory?: number} & Partial<{
      status: string;
      material: string;
      tags: string[];
      short: string;
    }>
  ) {
    const {inventory = 10, ...rest} = fields;
    await db.product.create({
      data: {
        id,
        brand: 'VAREL',
        sku: id.toUpperCase(),
        short: rest.short ?? 'A piece.',
        description: 'Made in the studio.',
        material: rest.material ?? 'Cotton',
        priceCents: 10000,
        ...rest,
        variants: {create: [{id: `${id}-v`, priceCents: 10000, inventory, size: 'M'}]},
        images: {create: [{key: `${id}.jpg`, src: photo.src}]},
      },
    });
  }

  beforeEach(async () => {
    await resetDatabase();
    const women = await db.department.create({data: {name: 'Women', slug: 'women', position: 1}});
    const objects = await db.department.create({data: {name: 'Objects', slug: 'objects', position: 2}});
    const knit = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: women.id, position: 1}});
    const trousers = await db.category.create({data: {name: 'Trousers', slug: 'trousers', departmentId: women.id, position: 2}});
    const outer = await db.category.create({data: {name: 'Outerwear', slug: 'coats', departmentId: women.id, position: 3}});
    const ceramics = await db.category.create({data: {name: 'Ceramics', slug: 'ceramics', departmentId: objects.id, position: 1}});

    await product('wool-crew', {name: 'Wool Crew', material: 'Merino wool', departmentId: women.id, categoryId: knit.id, position: 1});
    await product('wool-trouser', {name: 'Wool Trouser', material: 'Wool', departmentId: women.id, categoryId: trousers.id, position: 2});
    await product('linen-trouser', {name: 'Linen Trouser', material: 'Linen', departmentId: women.id, categoryId: trousers.id, position: 3});
    await product('sold-wool', {name: 'Sold Wool Coat', material: 'Wool', departmentId: women.id, categoryId: outer.id, position: 4, inventory: 0});
    await product('draft-wool', {name: 'Draft Wool', status: 'draft', departmentId: women.id, categoryId: knit.id, position: 5});
    await product('stone-bowl', {name: 'Stone Bowl', material: 'Stoneware', tags: ['digital-free'], departmentId: objects.id, categoryId: ceramics.id, position: 6});

    const now = Date.now();
    await db.post.createMany({
      data: [
        {slug: 'on-wool', title: 'On wool', category: 'Material', read: '4 min read', author: 'Ida Holm', excerpt: 'Why we knit.', image: photo, body: [], status: 'published', publishedAt: new Date(now - 2 * day)},
        {slug: 'studio-visit', title: 'A studio visit', category: 'Process', read: '6 min read', author: 'Ida Holm', excerpt: 'Behind the bench.', image: photo, body: [], status: 'published', publishedAt: new Date(now - day)},
        {slug: 'future-wool', title: 'Future wool', category: 'Material', read: '3 min read', author: 'Ida Holm', excerpt: 'Soon.', image: photo, body: [], status: 'published', publishedAt: new Date(now + 3 * day)},
        {slug: 'draft-wool', title: 'Draft wool', category: 'Material', read: '3 min read', author: 'Ida Holm', excerpt: 'Draft.', image: photo, body: [], status: 'draft', publishedAt: null},
      ],
    });
    await db.translation.createMany({
      data: [
        {entity: 'product', entityId: 'wool-crew', field: 'name', locale: 'da', value: 'Uldtrøje', sourceHash: 'x'},
        {entity: 'category', entityId: String(knit.id), field: 'name', locale: 'da', value: 'Strik', sourceHash: 'x'},
        {entity: 'department', entityId: String(women.id), field: 'name', locale: 'da', value: 'Kvinder', sourceHash: 'x'},
      ],
    });
  });

  const search = async (q: string | null, headers: Record<string, string> = {}) => {
    const path = q === null ? '/site-api/search' : `/site-api/search?q=${encodeURIComponent(q)}`;
    const res = await new Browser(app).request('GET', path, undefined, headers);
    return {...res, body: res.json as unknown as SearchResponse};
  };
  const ids = (r: {body: SearchResponse}) => r.body.products.map(p => p.id);

  it('answers an empty shape for a missing or blank term', async () => {
    for (const q of [null, '', '   ']) {
      const res = await search(q);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({query: '', products: [], categories: [], posts: []});
    }
  });

  it('refuses a term over 200 characters and a repeated q', async () => {
    const long = await search('a'.repeat(201));
    expect(long.status).toBe(422);
    expect(long.json).toMatchObject({error: 'invalid_input', fields: {q: expect.any(String)}});
    expect(long.headers.get('cache-control')).toBe('no-store');
    const twice = await new Browser(app).get('/site-api/search?q=a&q=b');
    expect(twice.status).toBe(422);
  });

  it('finds published products holding every word, case-insensitively', async () => {
    const wool = await search('wool');
    expect(wool.status).toBe(200);
    expect(wool.headers.get('cache-control')).toBe('private, max-age=30');
    expect(wool.body.query).toBe('wool');
    expect(ids(wool)).toEqual(['wool-crew', 'wool-trouser', 'sold-wool']);
    expect(wool.body.products[0]).toMatchObject({id: 'wool-crew', name: 'Wool Crew', dept: 'Women', category: 'Knitwear'});

    expect(ids(await search('WOOL'))).toEqual(ids(wool));
    expect(ids(await search('  wool   trouser '))).toEqual(['wool-trouser']);
    expect((await search('wool trouser')).body.query).toBe('wool trouser');
    expect(ids(await search('draft'))).toEqual([]);
  });

  it('lists categories of matching products, then categories matched by name', async () => {
    const trouser = await search('trouser');
    expect(trouser.body.categories).toEqual([
      {dept: 'Women', category: 'Trousers', count: 2, deptLabel: 'Women', categoryLabel: 'Trousers', deptSlug: 'women', categorySlug: 'trousers'},
    ]);
    // "outerwear" names a category; its published products count, the sold-out coat included.
    const outer = await search('outerwear');
    expect(outer.body.categories).toEqual([
      expect.objectContaining({dept: 'Women', category: 'Outerwear', count: 1, categorySlug: 'coats'}),
    ]);
  });

  it('hides sold-out products when the store says so, but keeps their category', async () => {
    await db.setting.update({where: {id: 1}, data: {hideSoldOut: true}});
    const wool = await search('wool');
    expect(ids(wool)).toEqual(['wool-crew', 'wool-trouser']);
    const outer = await search('outerwear');
    expect(outer.body.products).toEqual([]);
    expect(outer.body.categories).toEqual([expect.objectContaining({category: 'Outerwear', count: 1})]);
  });

  it('finds published, current posts by title, author and category', async () => {
    expect((await search('wool')).body.posts.map(p => p.slug)).toEqual(['on-wool']);
    expect((await search('ida')).body.posts.map(p => p.slug)).toEqual(['studio-visit', 'on-wool']);
    expect((await search('process')).body.posts.map(p => p.slug)).toEqual(['studio-visit']);
    const post = (await search('studio visit')).body.posts[0];
    expect(post).toMatchObject({slug: 'studio-visit', title: 'A studio visit', category: 'Process', read: '6 min read'});
  });

  it('matches and labels in the request language, links stay English', async () => {
    const da = await search('uldtrøje', {'x-locale': 'da'});
    expect(ids(da)).toEqual(['wool-crew']);
    expect(da.body.products[0]?.name).toBe('Uldtrøje');
    expect(da.body.categories[0]).toMatchObject({dept: 'Women', category: 'Knitwear', deptLabel: 'Kvinder', categoryLabel: 'Strik'});
    // A translated category name matches too.
    const strik = await search('strik', {'x-locale': 'da'});
    expect(strik.body.categories.map(c => c.category)).toEqual(['Knitwear']);
    // English requests never see the overlay.
    expect(ids(await search('uldtrøje'))).toEqual([]);
  });

  it('matches tags and stays within its caps', async () => {
    expect(ids(await search('digital'))).toEqual(['stone-bowl']);
    const all = await search('a');
    expect(all.body.products.length).toBeLessThanOrEqual(100);
    expect(all.body.categories.length).toBeLessThanOrEqual(100);
    expect(all.body.posts.length).toBeLessThanOrEqual(100);
  });
});
