import {hc} from 'hono/client';

import {siteFetch} from '../platform/browser';
import type {AppType} from '../server/app';

/**
 * The typed Site API client for the browser: same origin, so the visitor's
 * cookies ride along. Every call goes through `siteFetch`, which adds the
 * CSRF header on writes and refreshes an expired session ONCE. Only the TYPE
 * of the server app is imported — no server code reaches the browser.
 */
export const api = hc<AppType>('/', {fetch: siteFetch})['site-api'];

/** An error carrying the server's field errors, for `form.setServerErrors`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {}
  ) {
    super(message);
  }
}

/** The JSON body of a Site API response, or an `ApiError` carrying its message. */
export async function read<T>(response: Promise<Response>): Promise<T> {
  const res = await response;
  const body = (await res.json().catch(() => null)) as
    | (T & {message?: string; fields?: Record<string, string>})
    | null;
  if (!res.ok) throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status, body?.fields);
  return body as T;
}

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

/** `?a=1&b=x,y` from an object: undefined, null and empty values left out, lists comma-joined (VAREL's format). */
export function toQueryString(query: Record<string, QueryValue> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    const s = Array.isArray(v) ? v.join(',') : String(v);
    if (s !== '') sp.set(k, s);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * The store admin's Site API (`/site-api/manage/<area>/…`, src/server/routes/admin/*),
 * by path, for reads and writes that are not (yet) on the typed client above:
 * `manage<OrdersPage>('orders', {query: {q, before}})`,
 * `manage('orders/1001', {method: 'PATCH', body: {...}})`. Goes through `siteFetch`
 * (CSRF header on writes, one session refresh) and answers like `read()`: the
 * JSON body, or an `ApiError` with the server's message and field errors.
 * Prefer the typed client (`api.manage.<area>.$get(...)`) once the route's types
 * are in `src/server/app.ts`.
 */
export function manage<T>(
  path: string,
  {method = 'GET', query, body, signal}: {method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal} = {}
): Promise<T> {
  const url = `/site-api/manage/${path.replace(/^\/+/, '')}${toQueryString(query)}`;
  return read<T>(
    siteFetch(url, {
      method,
      signal,
      headers: body === undefined ? undefined : {'content-type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

/**
 * The store admin's abilities (`/me` `abilities`, docs/migration/PLAN.md §7): one per
 * VAREL permission area, plus the template's own. Declared here as names so the
 * shell and screens can check them before every catalogue entry exists.
 */
export type AreaAbility =
  | 'manageOrders'
  | 'manageCustomers'
  | 'manageProducts'
  | 'manageContent'
  | 'manageDiscounts'
  | 'viewAnalytics'
  | 'manageStoreSettings'
  | 'manageUsers'
  | 'manageRoles'
  | 'readAudit';

/** True when `/me` granted the ability. Hides UI only: the route's guard is the enforcement. */
export function hasAbility(abilities: object | null | undefined, name: AreaAbility): boolean {
  return Boolean(abilities && (abilities as Partial<Record<string, boolean>>)[name]);
}
