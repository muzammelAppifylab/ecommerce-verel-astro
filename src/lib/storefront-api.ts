/* Storefront islands → Site API (port of VAREL src/lib/api/client.ts, PLAN.md §2).
   Same surface as VAREL's `api` (get/post/patch/del, ApiError, errorMessage) on top of the template's
   `siteFetch` (same-origin cookies, CSRF header on writes, one shared refresh on `401 token_expired`).
   Every call carries `X-Locale` (the page's language) so server text comes back translated, and the
   visitor's guest id travels in its cookie. Paths are relative to `/site-api` ("/cart", "/products/x").
   Client-safe; pages read through `backend(Astro.request)` instead (in-process). */
import {siteFetch} from '../platform/browser';
import {currentLocale, LOCALE_HEADER} from './i18n';

/** Prefix of every Site API path. */
export const API_BASE = '/site-api';

/** Thrown for any non-2xx response (or a network failure, code `NETWORK`). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** Message for a specific form field, if the server sent one. */
  field(name: string): string | undefined {
    return this.fields?.[name];
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Human message for any thrown value, in VAREL voice. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) return e.message || fallback;
  return fallback;
}

export type Query = Record<string, string | number | boolean | string[] | null | undefined>;

/** Builds `?a=1&b=x,y` — arrays are comma-joined, empty values skipped. */
export function toQueryString(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','));
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Language to answer in (default: the page's `<html lang>`). */
  locale?: string;
}

type ErrorShape = {
  /** VAREL shape: { error: { code, message, fields? } }; template shape: { error: 'code', message, fields? } */
  error?: string | {code?: string; message?: string; fields?: Record<string, string>};
  message?: string;
  fields?: Record<string, string>;
};

/** An ApiError from an error response body, whichever of the two error shapes it uses. */
export function apiErrorOf(status: number, data: unknown): ApiError {
  const body = (data && typeof data === 'object' ? data : {}) as ErrorShape;
  const e = body.error;
  const code = typeof e === 'string' ? e : (e?.code ?? `HTTP_${status}`);
  const message =
    (typeof e === 'object' ? e?.message : undefined) ??
    body.message ??
    (status === 404 ? 'Not found.' : 'Something went wrong. Please try again.');
  const fields = (typeof e === 'object' ? e?.fields : undefined) ?? body.fields;
  return new ApiError(status, code, message, fields);
}

/** JSON in/out through siteFetch; throws ApiError on failure. 204 → undefined. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const {method = 'GET', body, query, signal} = opts;
  let res: Response;
  try {
    res = await siteFetch(API_BASE + path + toQueryString(query), {
      method,
      headers: {
        Accept: 'application/json',
        [LOCALE_HEADER]: opts.locale ?? currentLocale(),
        ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'We could not reach the studio. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) throw apiErrorOf(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, {query, signal}),
  post: <T>(path: string, body?: unknown) => request<T>(path, {method: 'POST', body: body ?? {}}),
  put: <T>(path: string, body?: unknown) => request<T>(path, {method: 'PUT', body: body ?? {}}),
  patch: <T>(path: string, body?: unknown) => request<T>(path, {method: 'PATCH', body: body ?? {}}),
  del: <T>(path: string) => request<T>(path, {method: 'DELETE'}),
};
