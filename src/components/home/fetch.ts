/*
 * The New-in grid's product reads in the browser (VAREL used TanStack Query's `useProducts` with
 * `keepPreviousData`). One request at a time per island: a new filter aborts the previous request, and
 * answers are memoised per query for the visit (at most 20), so switching back is instant.
 */
import {api} from '@/lib/storefront-api';
import type {ProductListResponse, ProductQuery} from '@/lib/types/catalog';

const MEMO_LIMIT = 20;

export const queryKey = (q: ProductQuery): string =>
  Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');

export function createProductLoader() {
  const memo = new Map<string, ProductListResponse>();
  let controller: AbortController | null = null;
  return {
    peek: (q: ProductQuery) => memo.get(queryKey(q)),
    seed(q: ProductQuery, data: ProductListResponse) {
      memo.set(queryKey(q), data);
    },
    async load(q: ProductQuery, {fresh = false}: {fresh?: boolean} = {}): Promise<ProductListResponse> {
      const key = queryKey(q);
      const hit = memo.get(key);
      if (hit && !fresh) return hit;
      controller?.abort();
      const own = new AbortController();
      controller = own;
      const data = await api.get<ProductListResponse>('/products', {...q}, own.signal);
      if (controller === own) controller = null;
      memo.delete(key);
      memo.set(key, data);
      if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
      return data;
    },
    abort() {
      controller?.abort();
      controller = null;
    },
  };
}

export const isAbort = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as {name?: string}).name === 'AbortError';
