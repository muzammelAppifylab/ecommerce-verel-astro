/**
 * Typed URL search params for the dashboard's routes (VAREL `src/lib/search-params.ts`).
 *
 * The router (src/portal/PortalApp.tsx) parses and writes PLAIN query strings, as
 * VAREL's admin did: every raw value arrives here as a string, lists are
 * comma-separated (`?payment=Paid,Pending`) and numbers are digits (`?page=2`).
 * Each `validate*Search` in `queries/<area>.ts` is a route's `validateSearch`: it
 * turns the raw strings into a typed object and drops anything malformed. Every key
 * is optional, so links never have to pass one.
 */

export type RawSearch = Record<string, unknown>;

/** Non-empty trimmed string, or undefined. */
export function str(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

/** Comma-separated list ("a,b") or an array, as a non-empty string[] (or undefined). */
export function list(v: unknown): string[] | undefined {
  const parts = Array.isArray(v) ? v.map(String) : (str(v)?.split(',') ?? []);
  const out = parts.map(s => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

/** One of `allowed`, or undefined. */
export function oneOf<const T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const s = str(v);
  return s !== undefined && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
}

/** The values of a list that are in `allowed` (undefined when none are). */
export function listOf<T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined {
  const out = (list(v) ?? []).filter((s): s is T => (allowed as readonly string[]).includes(s));
  return out.length ? out : undefined;
}

/** A page number above 1 (page 1 stays out of the URL). */
export function pageNum(v: unknown): number | undefined {
  const n = Number(str(v));
  return Number.isInteger(n) && n > 1 ? n : undefined;
}

/** A `YYYY-MM-DD` date, or undefined. */
export function isoDate(v: unknown): string | undefined {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

/** Drop undefined keys so links and navigation never write `?key=` noise. */
export function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** The router's parser: `?a=1&b=x,y` → `{a: '1', b: 'x,y'}` (no JSON decoding). */
export function parseSearch(searchStr: string): RawSearch {
  const out: RawSearch = {};
  for (const [k, v] of new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)) out[k] = v;
  return out;
}

/** The router's writer: arrays comma-joined, empty values left out. */
export function stringifySearch(search: RawSearch): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null) continue;
    const s = Array.isArray(v) ? v.join(',') : String(v);
    if (s !== '') sp.set(k, s);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Report window: the last n days, or the store's whole history. */
export type Period = 7 | 30 | 90 | 'all';

/** `?days=` search param → Period. 30 is the default and stays out of the URL. */
export function parsePeriod(v: unknown): Exclude<Period, 30> | undefined {
  if (v === 'all') return 'all';
  const n = Number(v);
  return n === 7 || n === 90 ? n : undefined;
}
