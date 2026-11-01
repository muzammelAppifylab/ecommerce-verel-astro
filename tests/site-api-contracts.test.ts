import {Hono} from 'hono';
import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {
  csvCell,
  decodeCursor,
  encodeCursor,
  keysetPage,
  keysetWhere,
  orderByOf,
  pageSizeOf,
  parseSort,
  problemOf,
  toProblem,
  wireCode,
} from '../src/server/lib/http';
import {intId, json, multiValue, params, parse, query} from '../src/server/lib/validate';
import {cartRoutes} from '../src/server/routes/cart';
import {taxonomyRoutes} from '../src/server/routes/catalog';
import {postRoutes} from '../src/server/routes/posts';

/** F3 contracts: the error shape, keyset helpers, validators and the Wave 0 route stubs. */
describe('error shape', () => {
  it('lower-cases VAREL codes and maps VALIDATION_ERROR', () => {
    expect(wireCode('DISCOUNT_INVALID')).toBe('discount_invalid');
    expect(wireCode('VALIDATION_ERROR')).toBe('invalid_input');
    expect(problemOf('NOT_FOUND', 'Gone')).toEqual({error: 'not_found', message: 'Gone'});
    expect(problemOf('x', 'y', {})).toEqual({error: 'x', message: 'y'});
  });

  it('maps thrown errors', () => {
    const domain = Object.assign(new Error('Out of stock'), {name: 'HttpError', status: 409, code: 'OUT_OF_STOCK'});
    expect(toProblem(domain)).toEqual({status: 409, body: {error: 'out_of_stock', message: 'Out of stock'}});
    const zodErr = z.object({a: z.string()}).safeParse({a: 1}).error;
    expect(toProblem(zodErr)?.status).toBe(422);
    expect(toProblem(zodErr)?.body.fields).toHaveProperty('a');
    const prisma = Object.assign(new Error('x'), {name: 'PrismaClientKnownRequestError', code: 'P2002'});
    expect(toProblem(prisma)?.status).toBe(409);
    expect(toProblem(new Error('boom'))).toBeNull();
  });
});

describe('keyset paging', () => {
  it('round-trips cursors and refuses bad ones', () => {
    const when = new Date('2026-10-01T10:00:00.000Z');
    const cursor = encodeCursor([when, 42]);
    expect(decodeCursor(cursor)).toEqual(['2026-10-01T10:00:00.000Z', 42]);
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(encodeCursor([1]))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('builds the where, order and page', () => {
    expect(keysetWhere('placedAt', 'desc', null)).toEqual({});
    expect(keysetWhere('placedAt', 'desc', ['2026-01-01', 5])).toEqual({
      OR: [{placedAt: {lt: '2026-01-01'}}, {placedAt: '2026-01-01', id: {lt: 5}}],
    });
    expect(keysetWhere('id', 'asc', [5, 5])).toEqual({id: {gt: 5}});
    expect(orderByOf('placedAt', 'desc')).toEqual([{placedAt: 'desc'}, {id: 'desc'}]);
    const page = keysetPage([{id: 1}, {id: 2}, {id: 3}], 2, r => [r.id, r.id]);
    expect(page.items).toEqual([{id: 1}, {id: 2}]);
    expect(decodeCursor(page.nextCursor)).toEqual([2, 2]);
    expect(keysetPage([{id: 1}], 2, r => [r.id, r.id]).nextCursor).toBeNull();
    expect(pageSizeOf('500')).toBe(100);
    expect(pageSizeOf('abc')).toBe(25);
  });

  it('whitelists sorts and escapes CSV formulas', () => {
    expect(parseSort('-total', ['placedAt', 'total'] as const, '-placedAt')).toEqual({field: 'total', dir: 'desc'});
    expect(parseSort(undefined, ['placedAt'] as const, '-placedAt')).toEqual({field: 'placedAt', dir: 'desc'});
    expect(parseSort('email', ['placedAt'] as const, '-placedAt')).toBeNull();
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});

describe('validators', () => {
  const app = new Hono()
    .post('/items', json(z.object({qty: z.number().int().min(1, 'Add at least one')})), c => c.json(c.req.valid('json')))
    .get('/list', query(z.object({color: multiValue(3)})), c => c.json(c.req.valid('query')))
    .get('/orders/:id', params(z.object({id: intId()})), c => c.json(c.req.valid('param')));

  it('answers 422 with field messages', async () => {
    const bad = await app.request('/items', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"qty":0}'});
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({error: 'invalid_input', message: 'Check the highlighted fields', fields: {qty: 'Add at least one'}});
    const ok = await app.request('/items', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"qty":2}'});
    expect(await ok.json()).toEqual({qty: 2});
  });

  it('reads repeated and comma-separated query values', async () => {
    const res = await app.request('/list?color=a,b&color=c&color=d');
    expect(await res.json()).toEqual({color: ['a', 'b', 'c']});
  });

  it('parses Int ids from the path', async () => {
    expect(await (await app.request('/orders/42')).json()).toEqual({id: 42});
    expect((await app.request('/orders/abc')).status).toBe(422);
    expect((await app.request('/orders/0')).status).toBe(422);
    expect((await app.request('/orders/99999999999')).status).toBe(422);
  });

  it('parse throws a 422 InputError', () => {
    expect(() => parse(z.object({a: z.string()}), {})).toThrow();
    try {
      parse(z.object({a: z.string()}), {});
    } catch (e) {
      expect(toProblem(e)?.status).toBe(422);
    }
  });
});

describe('Wave 0 route stubs', () => {
  it('answer 501 not_implemented until their package fills them', async () => {
    const res = await cartRoutes.request('/');
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({error: 'not_implemented'});
  });

  it('sitemap and feed slots answer empty lists', async () => {
    expect(await (await taxonomyRoutes.request('/sitemap')).json()).toEqual({items: []});
    expect(await (await postRoutes.request('/sitemap')).json()).toEqual({items: []});
    expect(await (await postRoutes.request('/feed')).json()).toEqual({items: []});
  });
});
