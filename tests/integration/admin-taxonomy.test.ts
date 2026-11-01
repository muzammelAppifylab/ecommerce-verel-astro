import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** `/site-api/manage/taxonomy` (WP-18) against Postgres: departments and categories. */

type Cat = {id: string; name: string; slug: string; position: number; productCount: number};
type Dept = Cat & {categories: Cat[]};

const product = (id: string, departmentId: number, categoryId: number, status = 'published') =>
  db.product.create({
    data: {id, name: id, brand: 'Varel', priceCents: 100, sku: `SKU-${id}`, short: '', description: '', material: '', status, departmentId, categoryId},
  });

describe.skipIf(!DATABASE_URL)('taxonomy admin (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.32');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.33');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
  });

  it('creates departments last in order, with slugs and counts; refuses clashes', async () => {
    const a = await staff.post('/site-api/manage/taxonomy/departments', {name: 'Women'});
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({name: 'Women', slug: 'women', position: 0, productCount: 0, categories: []});
    expect(typeof a.json.id).toBe('string');
    const b = await staff.post('/site-api/manage/taxonomy/departments', {name: 'Men'});
    expect(b.json).toMatchObject({position: 1});

    const clash = await staff.post('/site-api/manage/taxonomy/departments', {name: 'women!'});
    expect(clash.status).toBe(409);
    expect(clash.json).toMatchObject({error: 'slug_taken', fields: {name: 'A department with that name already exists'}});
    expect((await staff.post('/site-api/manage/taxonomy/departments', {name: '!!!'})).status).toBe(422);

    const list = await staff.get('/site-api/manage/taxonomy/departments');
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toContain('no-store');
    expect((list.json as unknown as Dept[]).map(d => d.name)).toEqual(['Women', 'Men']);
  });

  it('renames (slug follows), reorders, and refuses a rename onto another slug', async () => {
    const w = (await staff.post('/site-api/manage/taxonomy/departments', {name: 'Women'})).json as unknown as Dept;
    await staff.post('/site-api/manage/taxonomy/departments', {name: 'Men'});
    const renamed = await staff.request('PATCH', `/site-api/manage/taxonomy/departments/${w.id}`, {name: 'Womenswear', position: 5});
    expect(renamed.status).toBe(200);
    expect(renamed.json).toMatchObject({name: 'Womenswear', slug: 'womenswear', position: 5});
    const clash = await staff.request('PATCH', `/site-api/manage/taxonomy/departments/${w.id}`, {name: 'Men'});
    expect(clash.status).toBe(409);
    expect(clash.json.error).toBe('slug_taken');
    expect((await staff.request('PATCH', `/site-api/manage/taxonomy/departments/${w.id}`, {})).status).toBe(200);
    expect((await staff.request('PATCH', '/site-api/manage/taxonomy/departments/999', {name: 'X'})).status).toBe(404);
    expect((await staff.request('PATCH', '/site-api/manage/taxonomy/departments/abc', {name: 'X'})).status).toBe(404);
  });

  it('categories: per-department slugs, counts, in-use refusals, cascade', async () => {
    const w = (await staff.post('/site-api/manage/taxonomy/departments', {name: 'Women'})).json as unknown as Dept;
    const m = (await staff.post('/site-api/manage/taxonomy/departments', {name: 'Men'})).json as unknown as Dept;
    const shirts = await staff.post(`/site-api/manage/taxonomy/departments/${w.id}/categories`, {name: 'Shirts'});
    expect(shirts.status).toBe(201);
    expect(shirts.json).toMatchObject({name: 'Shirts', slug: 'shirts', position: 0, productCount: 0});
    const dup = await staff.post(`/site-api/manage/taxonomy/departments/${w.id}/categories`, {name: 'shirts'});
    expect(dup.status).toBe(409);
    expect(dup.json.fields).toEqual({name: 'Women already has a category with that name'});
    expect((await staff.post(`/site-api/manage/taxonomy/departments/${m.id}/categories`, {name: 'Shirts'})).status).toBe(201);
    const knit = (await staff.post(`/site-api/manage/taxonomy/departments/${w.id}/categories`, {name: 'Knitwear'})).json as unknown as Cat;
    expect(knit.position).toBe(1);

    const shirtId = Number((shirts.json as unknown as Cat).id);
    await product('p1', Number(w.id), shirtId);
    await product('p2', Number(w.id), shirtId, 'archived');

    const list = (await staff.get('/site-api/manage/taxonomy/departments')).json as unknown as Dept[];
    const women = list.find(d => d.id === w.id)!;
    expect(women.productCount).toBe(2);
    expect(women.categories.map(c => [c.name, c.productCount])).toEqual([
      ['Shirts', 2],
      ['Knitwear', 0],
    ]);

    const inUse = await staff.delete(`/site-api/manage/taxonomy/categories/${shirtId}`);
    expect(inUse.status).toBe(409);
    expect(inUse.json).toMatchObject({error: 'in_use'});
    expect((await staff.delete(`/site-api/manage/taxonomy/departments/${w.id}`)).status).toBe(409);

    const renamed = await staff.request('PATCH', `/site-api/manage/taxonomy/categories/${knit.id}`, {name: 'Shirts'});
    expect(renamed.status).toBe(409);
    expect((await staff.delete(`/site-api/manage/taxonomy/categories/${knit.id}`)).status).toBe(204);
    expect((await staff.delete('/site-api/manage/taxonomy/categories/999')).status).toBe(404);

    // An empty department goes with its categories.
    expect((await staff.delete(`/site-api/manage/taxonomy/departments/${m.id}`)).status).toBe(204);
    expect(await db.category.findMany({where: {departmentId: Number(m.id)}})).toEqual([]);
  });

  it('caps product counts at 101', async () => {
    const d = await db.department.create({data: {name: 'Big', slug: 'big'}});
    const c = await db.category.create({data: {name: 'All', slug: 'all', departmentId: d.id}});
    await db.product.createMany({
      data: Array.from({length: 102}, (_, i) => ({
        id: `p${i}`,
        name: `p${i}`,
        brand: 'V',
        priceCents: 1,
        sku: `S${i}`,
        short: '',
        description: '',
        material: '',
        departmentId: d.id,
        categoryId: c.id,
      })),
    });
    const [big] = (await staff.get('/site-api/manage/taxonomy/departments')).json as unknown as Dept[];
    expect(big!.productCount).toBe(101);
    expect(big!.categories[0]!.productCount).toBe(101);
    const refused = await staff.delete(`/site-api/manage/taxonomy/departments/${d.id}`);
    expect(refused.json.message).toContain('100+ products');
  });

  it('refuses a 101st department', async () => {
    await db.department.createMany({data: Array.from({length: 100}, (_, i) => ({name: `D${i}`, slug: `d${i}`, position: i}))});
    const res = await staff.post('/site-api/manage/taxonomy/departments', {name: 'One more'});
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('limit_reached');
  });

  it('guards: guests 401, customers 403 on reads and writes', async () => {
    expect((await new Browser(app).get('/site-api/manage/taxonomy/departments')).status).toBe(401);
    expect((await customer.get('/site-api/manage/taxonomy/departments')).status).toBe(403);
    expect((await customer.post('/site-api/manage/taxonomy/departments', {name: 'X'})).status).toBe(403);
  });
});
