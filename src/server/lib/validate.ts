import type {MiddlewareHandler} from 'hono';
import {validator} from 'hono/validator';
import {z} from 'zod';

import type {Problem} from '../../lib/types/common';
import {localizeFields, localizeMessage} from './contracts';

/**
 * Zod schemas as Hono validators (port of VAREL worker/middleware/validate.ts, PLAN.md §2).
 *
 * VAREL parsed inside the handler (`await body(c, schema)`); here the schema is a route
 * middleware, FIRST in the chain (docs/agent/site-api.md: validator → withViewer → … → withDb),
 * so a bad input is refused before any lookup and the typed client (`hc`) knows the input:
 *
 *   .post('/items', json(addToCartSchema), withDb, async c => {
 *     const input = c.req.valid('json');            // z.output of the schema
 *   })
 *
 * A failed parse answers `422 {error: 'invalid_input', message, fields: {'a.b': '…'}}` (the
 * template's field-error shape; forms put each message under its field). Repeated query keys
 * become arrays (`?color=a&color=b` → `['a', 'b']`), as VAREL's `queryObject` did. A JSON body
 * is read only with a JSON content type (anything else validates `{}`); malformed JSON is 400.
 */

// VAREL voice for zod's generic messages (schemas override these with field-specific copy).
z.config({
  customError: issue => {
    if (issue.code === 'invalid_type') return issue.input === undefined ? 'Fill in this field' : 'Check this field';
    if (issue.code === 'invalid_value') return 'Choose one of the listed options';
    return undefined;
  },
});

/** Turn zod issues into `{ "a.b": "message" }` (first message per path). */
export function zodFields(err: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** The 422 body for field problems. */
export function invalidInput(fields: Record<string, string>, message = 'Check the highlighted fields'): Problem & {fields: Record<string, string>} {
  return {error: 'invalid_input', message, fields};
}

/**
 * A 422 thrown from inside a handler or a library (`parse`). Shaped like the domain
 * `HttpError` (src/server/lib/errors.ts) so the app's error handler answers it the same way.
 */
export class InputError extends Error {
  readonly name = 'HttpError';
  readonly status = 422;
  readonly code = 'invalid_input';
  constructor(
    readonly fields: Record<string, string>,
    message = 'Check the highlighted fields'
  ) {
    super(message);
  }
}

/** Parse arbitrary input with a schema or throw a 422 (`InputError`). VAREL `parse`. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new InputError(zodFields(result.error));
  return result.data;
}

// ─── Hono validators ──────────────────────────────────────────────────────────

/** Query / param inputs as the typed client sends them: strings, optional where the schema allows. */
type StringsOf<T> = {[K in keyof T as undefined extends T[K] ? never : K]: string | string[]} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: string | string[];
};

type Validated<Target extends string, In, Out> = MiddlewareHandler<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  string,
  {in: {[K in Target]: In}; out: {[K in Target]: Out}}
>;

const check = <S extends z.ZodType>(schema: S) =>
  (value: unknown, c: Parameters<Parameters<typeof validator>[1]>[1]) => {
    const result = schema.safeParse(value ?? {});
    if (!result.success) {
      // In the request language, like the errors `app.onError` answers (English unchanged).
      const locale = (c.var as {locale?: string}).locale ?? c.req.header('x-locale');
      const fields = zodFields(result.error);
      if (!locale || locale === 'en') return c.json(invalidInput(fields), 422);
      return c.json(invalidInput(localizeFields(locale, fields) ?? fields, localizeMessage(locale, 'Check the highlighted fields')), 422);
    }
    return result.data;
  };

/** Validate the JSON body (`c.req.valid('json')`). */
export const json = <S extends z.ZodType>(schema: S) =>
  validator('json', check(schema)) as unknown as Validated<'json', z.input<S>, z.output<S>>;

/** Validate the query string (`c.req.valid('query')`). */
export const query = <S extends z.ZodType>(schema: S) =>
  validator('query', check(schema)) as unknown as Validated<'query', StringsOf<z.input<S>>, z.output<S>>;

/** Validate the path params (`c.req.valid('param')`). */
export const params = <S extends z.ZodType>(schema: S) =>
  validator('param', check(schema)) as unknown as Validated<'param', StringsOf<z.input<S>>, z.output<S>>;

// ─── Shared field schemas (VAREL) ─────────────────────────────────────────────

export const emailField = z
  .string({error: 'Enter your email address'})
  .trim()
  .min(1, 'Enter your email address')
  .max(254, 'That email address is too long')
  .pipe(z.email({error: 'Enter a valid email address'}))
  .transform(e => e.toLowerCase());

export const requiredText = (label: string, max = 200) =>
  z
    .string({error: `Enter ${label}`})
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Keep ${label} under ${max} characters`);

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .nullish()
    .transform(v => (v ? v : null));

/** A comma-separated or repeated multi-value query param → string[] (`?status=a,b` or `?status=a&status=b`). */
export const multiValue = (max = 20) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(v =>
      (Array.isArray(v) ? v : v ? [v] : [])
        .flatMap(s => s.split(','))
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, max)
    );

/** `?cursor=&pageSize=` of every keyset list (src/server/lib/http.ts reads the cursor). */
export const pageQuery = {
  cursor: z.string().trim().max(512).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
};

/**
 * A record id from a URL param or query: F1 made most ids `Int` (departments, categories, posts,
 * orders, discounts, …) while the wire carries them as strings. Accepts `"42"`, gives `42`; anything
 * else (not digits, 0, beyond int4) is a 422 before any lookup.
 *
 *   .get('/:id', params(z.object({id: intId()})), withDb, async c => { const {id} = c.req.valid('param'); … })
 */
export const intId = (message = 'Use a valid id') =>
  z
    .string({error: message})
    .trim()
    .regex(/^[1-9][0-9]{0,9}$/, message)
    .transform(Number)
    .refine(n => n <= 2_147_483_647, message);

/** A `BigInt` id (activity logs, analytics events): serialized as a string on the wire. */
export const bigIntId = (message = 'Use a valid id') =>
  z
    .string({error: message})
    .trim()
    .regex(/^[1-9][0-9]{0,18}$/, message)
    .transform(v => BigInt(v));
