import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma, PrismaClient} from '../../../generated/prisma/client';
import {requirePermission, withDb} from '../../../platform/guards';
import type {AdminCategory, AdminDepartment} from '../../../lib/types/admin/catalog';
import {queueEntityTranslation} from '../../lib/contracts';
import {conflict, invalid, notFound} from '../../lib/errors';
import {slugify} from '../../lib/format';
import {json} from '../../lib/validate';
import {PERMISSIONS} from '../../permissions';

/**
 * Admin: Departments and categories (WP-18). Port of VAREL worker/routes/admin/taxonomy.ts:
 * VAREL `/api/admin/<departments|categories>…` is `/site-api/manage/taxonomy…` here.
 *
 *   GET    /site-api/manage/taxonomy/departments       AdminDepartment[]
 *   POST   /site-api/manage/taxonomy/departments       {name, position?} → 201 AdminDepartment
 *   PATCH  /site-api/manage/taxonomy/departments/:id   {name?, position?} → AdminDepartment
 *   DELETE /site-api/manage/taxonomy/departments/:id   204; 409 in_use
 *   POST   /site-api/manage/taxonomy/departments/:id/categories {name, position?} → 201 AdminCategory
 *   PATCH  /site-api/manage/taxonomy/categories/:id    {name?, position?} → AdminCategory
 *   DELETE /site-api/manage/taxonomy/categories/:id    204; 409 in_use
 *
 * Guarded centrally (src/server/routes/admin/index.ts): reads are open to any staff area, writes need
 * the products area; writes also `requirePermission(PRODUCT_MANAGE)` here.
 *
 * Differences from VAREL: ids are Int in the database and strings on the wire; product counts are
 * bounded (at most 101 rows counted per department/category, the screen shows "100+"); a shop has at
 * most 100 departments and 100 categories per department (409 `limit_reached`), so every read stays
 * ≤ 100 rows; single-row answers re-read only that row.
 */

type Db = PrismaClient;

/** Departments per shop, and categories per department. */
export const TAXONOMY_LIMIT = 100;
/** Product counts stop at this (one past the limit, so "100+" can be told apart from 100). */
export const COUNT_CAP = TAXONOMY_LIMIT + 1;

// ─── Validation ───────────────────────────────────────────────────────────────

const nameField = z.string({error: 'Enter a name'}).trim().min(1, 'Enter a name').max(80, 'Keep the name under 80 characters');
const positionField = z.coerce
  .number({error: 'Use a number'})
  .int('Use a whole number')
  .min(0, 'Use zero or more')
  .max(10_000, 'Use 10000 or less');

export const createBody = z.object({name: nameField, position: positionField.optional()});
export const patchBody = z.object({name: nameField.optional(), position: positionField.optional()});

/** A path id: a positive int4, or 404 with the area's message. */
export function idOf(raw: string, message: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw notFound(message);
  const n = Number(raw);
  if (n > 2_147_483_647) throw notFound(message);
  return n;
}

/** The slug of a name, or 422 when nothing is left of it. */
export function slugOr422(name: string): string {
  const slug = slugify(name);
  if (!slug) throw invalid({name: 'Use at least one letter or number'});
  return slug;
}

/** "12 products", "100+ products" past the cap. */
export const countText = (n: number) => (n > TAXONOMY_LIMIT ? `${TAXONOMY_LIMIT}+ products` : `${n} ${n === 1 ? 'product' : 'products'}`);

const NO_DEPT = 'We cannot find that department';
const NO_CAT = 'We cannot find that category';

// ─── Bounded counts ───────────────────────────────────────────────────────────

/** Products per department, counted up to `COUNT_CAP` each (archived ones included, as VAREL). */
async function departmentCounts(db: Db, ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<{id: number; n: number}[]>`
    SELECT d.id, (SELECT count(*) FROM (SELECT 1 FROM products p WHERE p.department_id = d.id LIMIT ${COUNT_CAP}) s)::int AS n
    FROM unnest(${ids}::int[]) AS d(id)`;
  return new Map(rows.map(r => [Number(r.id), Number(r.n)]));
}

/** Products per category, counted up to `COUNT_CAP` each. */
async function categoryCounts(db: Db, ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<{id: number; n: number}[]>`
    SELECT c.id, (SELECT count(*) FROM (SELECT 1 FROM products p WHERE p.category_id = c.id LIMIT ${COUNT_CAP}) s)::int AS n
    FROM unnest(${ids}::int[]) AS c(id)`;
  return new Map(rows.map(r => [Number(r.id), Number(r.n)]));
}

// ─── Reads ────────────────────────────────────────────────────────────────────

const catSelect = {id: true, name: true, slug: true, position: true} satisfies Prisma.CategorySelect;
const deptSelect = {
  id: true,
  name: true,
  slug: true,
  position: true,
  categories: {select: catSelect, orderBy: [{position: 'asc'}, {name: 'asc'}], take: TAXONOMY_LIMIT},
} satisfies Prisma.DepartmentSelect;

type CatData = {id: number; name: string; slug: string; position: number};
type DeptData = CatData & {categories: CatData[]};

const serializeCategory = (cat: CatData, counts: Map<number, number>): AdminCategory => ({
  id: String(cat.id),
  name: cat.name,
  slug: cat.slug,
  position: cat.position,
  productCount: counts.get(cat.id) ?? 0,
});

async function serializeDepartments(db: Db, depts: DeptData[]): Promise<AdminDepartment[]> {
  const [deptN, catN] = await Promise.all([
    departmentCounts(
      db,
      depts.map(d => d.id)
    ),
    categoryCounts(
      db,
      depts.flatMap(d => d.categories.map(c => c.id))
    ),
  ]);
  return depts.map(d => ({
    id: String(d.id),
    name: d.name,
    slug: d.slug,
    position: d.position,
    productCount: deptN.get(d.id) ?? 0,
    categories: d.categories.map(c => serializeCategory(c, catN)),
  }));
}

async function listDepartments(db: Db): Promise<AdminDepartment[]> {
  const depts = await db.department.findMany({
    select: deptSelect,
    orderBy: [{position: 'asc'}, {name: 'asc'}],
    take: TAXONOMY_LIMIT,
  });
  return serializeDepartments(db, depts);
}

async function oneDepartment(db: Db, id: number): Promise<AdminDepartment> {
  const d = await db.department.findUnique({where: {id}, select: deptSelect});
  if (!d) throw notFound(NO_DEPT);
  return (await serializeDepartments(db, [d]))[0]!;
}

async function oneCategory(db: Db, id: number): Promise<AdminCategory> {
  const cat = await db.category.findUnique({where: {id}, select: catSelect});
  if (!cat) throw notFound(NO_CAT);
  return serializeCategory(cat, await categoryCounts(db, [cat.id]));
}

/** Prisma's foreign-key refusal (a product still points at the row). */
const isForeignKey = (e: unknown) => !!e && typeof e === 'object' && (e as {code?: unknown}).code === 'P2003';
/** Prisma's unique refusal (a concurrent create took the slug). */
const isUnique = (e: unknown) => !!e && typeof e === 'object' && (e as {code?: unknown}).code === 'P2002';

const inUse = (name: string, n: number) =>
  conflict(
    'IN_USE',
    n > 0
      ? `${name} still has ${countText(n)}. Move or delete them first`
      : `${name} is still used by products, including archived ones. Move them before deleting it`
  );

const deptTaken = () => conflict('SLUG_TAKEN', 'A department with that name already exists', {name: 'A department with that name already exists'});

// ─── Routes ───────────────────────────────────────────────────────────────────

const write = requirePermission(PERMISSIONS.PRODUCT_MANAGE);

export const taxonomyAdmin = new Hono()
  .use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
  })
  .get('/departments', withDb, async c => c.json(await listDepartments(c.var.db)))
  .post('/departments', write, json(createBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const slug = slugOr422(input.name);
    const [taken, last, full] = await Promise.all([
      db.department.findUnique({where: {slug}, select: {id: true}}),
      db.department.findFirst({orderBy: {position: 'desc'}, select: {position: true}}),
      db.department.findFirst({orderBy: {id: 'asc'}, skip: TAXONOMY_LIMIT - 1, select: {id: true}}),
    ]);
    if (taken) throw deptTaken();
    if (full) throw conflict('LIMIT_REACHED', `A shop can have up to ${TAXONOMY_LIMIT} departments`);
    let created: {id: number};
    try {
      created = await db.department.create({
        data: {name: input.name, slug, position: input.position ?? (last ? last.position + 1 : 0)},
        select: {id: true},
      });
    } catch (e) {
      if (isUnique(e)) throw deptTaken();
      throw e;
    }
    await queueEntityTranslation(db, 'department', created.id, {requestUrl: c.req.url});
    return c.json(await oneDepartment(db, created.id), 201);
  })
  .patch('/departments/:id', write, json(patchBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const id = idOf(c.req.param('id'), NO_DEPT);
    const d = await db.department.findUnique({where: {id}, select: {id: true, name: true}});
    if (!d) throw notFound(NO_DEPT);
    let slug: string | undefined;
    if (input.name !== undefined) {
      slug = slugOr422(input.name);
      const clash = await db.department.findFirst({where: {slug, NOT: {id}}, select: {id: true}});
      if (clash) throw deptTaken();
    }
    if (input.name !== undefined || input.position !== undefined) {
      try {
        await db.department.update({where: {id}, data: {name: input.name, slug, position: input.position}, select: {id: true}});
      } catch (e) {
        if (isUnique(e)) throw deptTaken();
        throw e;
      }
      if (input.name !== undefined) await queueEntityTranslation(db, 'department', id, {requestUrl: c.req.url});
    }
    return c.json(await oneDepartment(db, id));
  })
  .delete('/departments/:id', write, withDb, async c => {
    const db = c.var.db;
    const id = idOf(c.req.param('id'), NO_DEPT);
    const d = await db.department.findUnique({where: {id}, select: {id: true, name: true}});
    if (!d) throw notFound(NO_DEPT);
    const n = (await departmentCounts(db, [id])).get(id) ?? 0;
    if (n > 0) throw inUse(d.name, n);
    try {
      // Its categories go with it (onDelete: Cascade); products would block it (Restrict).
      await db.department.delete({where: {id}, select: {id: true}});
    } catch (e) {
      if (isForeignKey(e)) throw inUse(d.name, 0);
      throw e;
    }
    return c.body(null, 204);
  })
  .post('/departments/:id/categories', write, json(createBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const deptId = idOf(c.req.param('id'), NO_DEPT);
    const d = await db.department.findUnique({where: {id: deptId}, select: {id: true, name: true}});
    if (!d) throw notFound(NO_DEPT);
    const slug = slugOr422(input.name);
    const taken = () => conflict('SLUG_TAKEN', `${d.name} already has a category with that name`, {name: `${d.name} already has a category with that name`});
    const [clash, last, full] = await Promise.all([
      db.category.findUnique({where: {departmentId_slug: {departmentId: deptId, slug}}, select: {id: true}}),
      db.category.findFirst({where: {departmentId: deptId}, orderBy: {position: 'desc'}, select: {position: true}}),
      db.category.findFirst({where: {departmentId: deptId}, orderBy: {id: 'asc'}, skip: TAXONOMY_LIMIT - 1, select: {id: true}}),
    ]);
    if (clash) throw taken();
    if (full) throw conflict('LIMIT_REACHED', `A department can have up to ${TAXONOMY_LIMIT} categories`);
    let created: {id: number};
    try {
      created = await db.category.create({
        data: {name: input.name, slug, departmentId: deptId, position: input.position ?? (last ? last.position + 1 : 0)},
        select: {id: true},
      });
    } catch (e) {
      if (isUnique(e)) throw taken();
      throw e;
    }
    await queueEntityTranslation(db, 'category', created.id, {requestUrl: c.req.url});
    return c.json(await oneCategory(db, created.id), 201);
  })
  .patch('/categories/:id', write, json(patchBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const id = idOf(c.req.param('id'), NO_CAT);
    const cat = await db.category.findUnique({where: {id}, select: {id: true, departmentId: true}});
    if (!cat) throw notFound(NO_CAT);
    const taken = () =>
      conflict('SLUG_TAKEN', 'This department already has a category with that name', {
        name: 'This department already has a category with that name',
      });
    let slug: string | undefined;
    if (input.name !== undefined) {
      slug = slugOr422(input.name);
      const clash = await db.category.findFirst({where: {departmentId: cat.departmentId, slug, NOT: {id}}, select: {id: true}});
      if (clash) throw taken();
    }
    if (input.name !== undefined || input.position !== undefined) {
      try {
        await db.category.update({where: {id}, data: {name: input.name, slug, position: input.position}, select: {id: true}});
      } catch (e) {
        if (isUnique(e)) throw taken();
        throw e;
      }
      if (input.name !== undefined) await queueEntityTranslation(db, 'category', id, {requestUrl: c.req.url});
    }
    return c.json(await oneCategory(db, id));
  })
  .delete('/categories/:id', write, withDb, async c => {
    const db = c.var.db;
    const id = idOf(c.req.param('id'), NO_CAT);
    const cat = await db.category.findUnique({where: {id}, select: {id: true, name: true}});
    if (!cat) throw notFound(NO_CAT);
    const n = (await categoryCounts(db, [id])).get(id) ?? 0;
    if (n > 0) throw inUse(cat.name, n);
    try {
      await db.category.delete({where: {id}, select: {id: true}});
    } catch (e) {
      if (isForeignKey(e)) throw inUse(cat.name, 0);
      throw e;
    }
    return c.body(null, 204);
  });
