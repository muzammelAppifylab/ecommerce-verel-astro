import type {Context} from 'hono';
import {HTTPException} from 'hono/http-exception';
import type {ContentfulStatusCode} from 'hono/utils/http-status';

import {type CursorPage, MAX_PAGE_SIZE, PAGE_SIZE, type Problem} from '../../lib/types/common';
import {zodFields} from './validate';

/**
 * HTTP helpers shared by every route module: the error shape, the error handler's mapping, the
 * "not built yet" answer, keyset cursors and sort whitelists (PLAN.md §5 F3).
 *
 * ERRORS. The wire shape is the template's `{error: 'snake_code', message, fields?}` (`Problem`).
 * Routes either answer directly (`return apiError(c, 404, 'not_found', 'We cannot find that')`)
 * or THROW a domain `HttpError` (src/server/lib/errors.ts, F4: `throw notFound()`), a zod error or
 * a Prisma error; `app.onError` (src/server/app.ts) turns those into the same shape with
 * `toProblem`. VAREL's upper-case codes are lower-cased on the wire (`DISCOUNT_INVALID` →
 * `discount_invalid`); `VALIDATION_ERROR` becomes `invalid_input`.
 *
 * LISTS. Keyset pages (`CursorPage`, `?cursor=&pageSize=`), never offset or totals:
 *
 *   const {field, dir} = parseSort(q.sort, ['placedAt', 'total'] as const, '-placedAt');
 *   const after = decodeCursor(q.cursor);                 // [sortValue, id] | null
 *   const rows = await db.shopOrder.findMany({
 *     where: {...filters, ...keysetWhere(field, dir, after && [cursorDate(after[0]), after[1]])},
 *     orderBy: orderByOf(field, dir), take: size + 1, select,
 *   });
 *   return c.json(keysetPage(rows.map(toRow), size, r => [r.placedAt, r.id]));
 */

// ─── Errors ───────────────────────────────────────────────────────────────────

/** VAREL code → wire code: `DISCOUNT_INVALID` → `discount_invalid`, `VALIDATION_ERROR` → `invalid_input`. */
export function wireCode(code: string): string {
  const lower = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (lower === 'validation_error') return 'invalid_input';
  return lower || 'error';
}

/** The error body (`Problem`), fields only when there are some. */
export function problemOf(code: string, message: string, fields?: Record<string, string>): Problem {
  return {error: wireCode(code), message, ...(fields && Object.keys(fields).length ? {fields} : {})};
}

/** Answer an error: `return apiError(c, 409, 'SLUG_TAKEN', 'That address is taken', {slug: '…'})`. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  fields?: Record<string, string>
) {
  return c.json(problemOf(code, message, fields), status);
}

/** The answer of a route that its Wave 1 package has not built yet. */
export const NOT_IMPLEMENTED = problemOf('not_implemented', 'This part of the store is not ready yet.');

/** Stub handler: `501 {error: 'not_implemented', …}`. Replaced by each package's real handler. */
export const notImplemented = (c: Context) => c.json(NOT_IMPLEMENTED, 501);

/** The shape a thrown domain error has (`HttpError` from src/server/lib/errors.ts, `InputError`). */
export interface HttpErrorLike {
  name: 'HttpError';
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  if (!error || typeof error !== 'object') return false;
  const e = error as Partial<HttpErrorLike>;
  return e.name === 'HttpError' && typeof e.status === 'number' && typeof e.code === 'string';
}

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'signed_out',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'too_large',
  415: 'unsupported_media_type',
  422: 'invalid_input',
  429: 'too_many_requests',
};

const STATUS_MESSAGES: Record<number, string> = {
  400: 'We could not read that request',
  413: 'That request is too large',
};

/**
 * What a thrown error answers, or `null` for an unexpected one (the caller logs it and answers 500).
 * Handles domain `HttpError`s (by shape, so copies from any module match), zod errors, Hono's
 * `HTTPException` (malformed JSON → 400) and Prisma's not-found / unique errors (VAREL's mapping).
 */
export function toProblem(error: unknown): {status: ContentfulStatusCode; body: Problem} | null {
  if (isHttpErrorLike(error)) {
    const status = (error.status >= 400 && error.status <= 599 ? error.status : 500) as ContentfulStatusCode;
    return {status, body: problemOf(error.code, error.message, error.fields)};
  }
  if (error && typeof error === 'object' && (error as {name?: unknown}).name === 'ZodError') {
    const fields = zodFields(error as Parameters<typeof zodFields>[0]);
    return {status: 422, body: problemOf('invalid_input', 'Check the highlighted fields', fields)};
  }
  if (error instanceof HTTPException) {
    const status = error.status as ContentfulStatusCode;
    const message = STATUS_MESSAGES[status] ?? (error.message || 'That request could not be handled');
    return {status, body: problemOf(STATUS_CODES[status] ?? 'error', message)};
  }
  const prismaCode = error && typeof error === 'object' ? (error as {code?: unknown}).code : undefined;
  const prismaName = error && typeof error === 'object' ? (error as {name?: unknown}).name : undefined;
  if (prismaName === 'PrismaClientKnownRequestError') {
    if (prismaCode === 'P2025') return {status: 404, body: problemOf('not_found', 'We cannot find that')};
    if (prismaCode === 'P2002') return {status: 409, body: problemOf('conflict', 'That already exists')};
  }
  return null;
}

// ─── Keyset cursors ───────────────────────────────────────────────────────────

export type CursorValue = string | number | boolean | null;

const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
};

/** An opaque cursor for the row a page ended on: its sort value(s) and id. Dates become ISO strings. */
export function encodeCursor(values: readonly (CursorValue | Date)[]): string {
  return toBase64Url(JSON.stringify(values.map(v => (v instanceof Date ? v.toISOString() : v))));
}

/** The values of a cursor, or `null` when absent or malformed (a bad cursor starts from the top). */
export function decodeCursor(cursor: string | null | undefined, arity = 2): CursorValue[] | null {
  if (!cursor || cursor.length > 512) return null;
  try {
    const values = JSON.parse(fromBase64Url(cursor)) as unknown;
    if (!Array.isArray(values) || values.length !== arity) return null;
    return values.every(v => v === null || ['string', 'number', 'boolean'].includes(typeof v)) ? (values as CursorValue[]) : null;
  } catch {
    return null;
  }
}

/** A cursor value that was a Date (`null` when it is not a valid date). */
export function cursorDate(value: CursorValue | undefined): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `?pageSize=` clamped to 1–100 (default 25). */
export function pageSizeOf(raw: unknown, fallback = PAGE_SIZE): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PAGE_SIZE) : fallback;
}

/**
 * Rows after the cursor's row in `(field, id)` order. Rows were fetched with `take: size + 1`
 * and `orderBy: orderByOf(field, dir)`. `field` must be NOT NULL (keyset over nulls skips rows).
 */
export function keysetWhere(
  field: string,
  dir: 'asc' | 'desc',
  after: readonly [unknown, unknown] | null,
  idField = 'id'
): Record<string, unknown> {
  if (!after) return {};
  const [value, id] = after;
  const op = dir === 'desc' ? 'lt' : 'gt';
  if (field === idField || value === null || value === undefined) return {[idField]: {[op]: id}};
  return {OR: [{[field]: {[op]: value}}, {[field]: value, [idField]: {[op]: id}}]};
}

/** `orderBy` for a keyset list: the sort field, then the id as a tie-breaker. */
export function orderByOf(field: string, dir: 'asc' | 'desc', idField = 'id'): Record<string, 'asc' | 'desc'>[] {
  return field === idField ? [{[idField]: dir}] : [{[field]: dir}, {[idField]: dir}];
}

/** The page from `size + 1` rows: the first `size`, and a cursor when there were more. */
export function keysetPage<T>(rows: readonly T[], size: number, cursorOf: (row: T) => readonly (CursorValue | Date)[]): CursorPage<T> {
  const items = rows.slice(0, size);
  return {items, nextCursor: rows.length > size && items.length ? encodeCursor(cursorOf(items.at(-1)!)) : null};
}

// ─── Sort whitelists (VAREL admin/util.ts) ───────────────────────────────────

export interface Sort<K extends string> {
  field: K;
  dir: 'asc' | 'desc';
}

/** `-placedAt` → `{field: 'placedAt', dir: 'desc'}`; `null` for a field outside the whitelist (answer 422 `fields.sort`). */
export function parseSort<K extends string>(sort: string | undefined, allowed: readonly K[], fallback: string): Sort<K> | null {
  const raw = sort || fallback;
  const desc = raw.startsWith('-');
  const field = (desc ? raw.slice(1) : raw) as K;
  return allowed.includes(field) ? {field, dir: desc ? 'desc' : 'asc'} : null;
}

/** The 422 field message for a bad `sort`. */
export const sortProblem = (allowed: readonly string[]) => ({sort: `Sort by ${allowed.join(', ')} (prefix - for descending)`});

// ─── Responses ────────────────────────────────────────────────────────────────

/** Public, visitor-independent reads (never after `withViewer`): cache for `seconds`. */
export function publicCache(c: Context, seconds: number) {
  c.header('Cache-Control', `public, max-age=${Math.max(0, Math.trunc(seconds))}`);
}

type Cell = string | number | boolean | null | undefined | Date;

/** RFC 4180 escaping, plus a leading ' on text that a spreadsheet would run as a formula. */
export function csvCell(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvText(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A CSV download (admin exports: orders, subscribers, activity, discount codes). Bounded by the caller. */
export function csvResponse(filename: string, header: string[], rows: Cell[][]): Response {
  return new Response(csvText(header, rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '-')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
