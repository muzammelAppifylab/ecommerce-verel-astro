import {
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import type {
  AdminProduct,
  AdminProductInput,
  AdminProductRow,
  ProductBulkAction,
  ProductBulkResult,
} from '../../lib/types/admin/catalog';
import type {CursorPage} from '../../lib/types/common';
import {siteFetch} from '../../platform/browser';
import {manage, read} from '../api';
import {departmentsQuery} from './catalog';
import {clean, listOf, oneOf, type RawSearch, str} from './search-params';

/**
 * Products (`/dashboard/products`, `/new`, `/$id`). WP-17 owns this file
 * (`/site-api/manage/products`); WP-18's variants section reads through it.
 * Port of VAREL `src/lib/admin/products.ts` (products part) and
 * `src/pages/admin/products/search.ts` (product search). Lists are keyset pages
 * (`CursorPage`), so the search has no `page`.
 */

export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export const STOCK_FILTERS = ['in', 'low', 'out', 'digital'] as const;
export const PRODUCT_SORTS = ['name', '-name', 'price', '-price', 'inventory', '-inventory', 'updatedAt', '-updatedAt'] as const;
export const DEFAULT_PRODUCT_SORT = '-updatedAt';

export interface ProductsSearch {
  q?: string;
  status?: (typeof PRODUCT_STATUSES)[number][];
  dept?: string;
  category?: string;
  stock?: (typeof STOCK_FILTERS)[number][];
  sort?: (typeof PRODUCT_SORTS)[number];
}

export function validateProductsSearch(raw: RawSearch): ProductsSearch {
  const sort = oneOf(raw.sort, PRODUCT_SORTS);
  return clean({
    q: str(raw.q),
    status: listOf(raw.status, PRODUCT_STATUSES),
    dept: str(raw.dept),
    category: str(raw.category),
    stock: listOf(raw.stock, STOCK_FILTERS),
    sort: sort === DEFAULT_PRODUCT_SORT ? undefined : sort,
  });
}

/* ---------- Keys and reads ---------- */

export const productsKey = ['admin', 'products'] as const;
export const PRODUCTS_PAGE_SIZE = 25;

export type ProductListParams = ProductsSearch & {pageSize?: number};

/** The list params for a search (one place, so the loader and the screen share the cache entry). */
export const productListParams = (search: ProductsSearch): ProductListParams => ({
  q: search.q,
  status: search.status,
  dept: search.dept,
  category: search.category,
  stock: search.stock,
  sort: search.sort,
  pageSize: PRODUCTS_PAGE_SIZE,
});

/** The list, keyset-paged (`Load more`): `?q&status&dept&category&stock&sort&cursor&pageSize`. */
export const productListQuery = (params: ProductListParams) =>
  infiniteQueryOptions({
    queryKey: [...productsKey, 'list', params] as const,
    queryFn: ({pageParam, signal}) =>
      manage<CursorPage<AdminProductRow>>('products', {
        query: {
          q: params.q,
          status: params.status,
          dept: params.dept,
          category: params.category,
          stock: params.stock,
          sort: params.sort ?? DEFAULT_PRODUCT_SORT,
          pageSize: params.pageSize ?? PRODUCTS_PAGE_SIZE,
          cursor: pageParam || undefined,
        },
        signal,
      }),
    initialPageParam: '',
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const productQuery = (id: string) =>
  queryOptions({
    queryKey: [...productsKey, 'detail', id] as const,
    queryFn: ({signal}) => manage<AdminProduct>(`products/${encodeURIComponent(id)}`, {signal}),
    retry: (count, error) => (error as {status?: number}).status !== 404 && count < 2,
  });

/** The store currency (`/site-api/settings/public`), for money symbols in the editor; USD when unknown. */
export const productCurrencyQuery = queryOptions({
  queryKey: ['public-settings', 'currency'] as const,
  queryFn: ({signal}) =>
    read<{currency?: string}>(siteFetch('/site-api/settings/public', {signal}))
      .then(s => (typeof s?.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? s.currency : 'USD'))
      .catch(() => 'USD'),
  staleTime: 5 * 60_000,
});

/** "$", "kr.", "€": the symbol a currency shows before an amount. */
export function productCurrencySymbol(currency: string | undefined): string {
  try {
    return (
      new Intl.NumberFormat('en', {style: 'currency', currency: currency || 'USD'}).formatToParts(0).find(p => p.type === 'currency')
        ?.value ?? '$'
    );
  } catch {
    return '$';
  }
}

/* ---------- Route loaders (src/portal/routes.tsx) ---------- */

export const loadProducts = (queryClient: QueryClient, search: ProductsSearch): Promise<void> =>
  Promise.all([
    queryClient.ensureInfiniteQueryData(productListQuery(productListParams(search))),
    queryClient.ensureQueryData(departmentsQuery).catch(() => undefined),
  ]).then(() => undefined);

/** Taxonomy and the settings the editor needs. */
export const loadNewProduct = (queryClient: QueryClient): Promise<void> =>
  Promise.all([
    queryClient.ensureQueryData(departmentsQuery).catch(() => undefined),
    queryClient.ensureQueryData(productCurrencyQuery),
  ]).then(() => undefined);

/** A 404 shows in the screen, so a failed read resolves too. */
export const loadProduct = (queryClient: QueryClient, id: string): Promise<void> =>
  Promise.all([
    queryClient.ensureQueryData(productQuery(id)).catch(() => undefined),
    queryClient.ensureQueryData(departmentsQuery).catch(() => undefined),
    queryClient.ensureQueryData(productCurrencyQuery),
  ]).then(() => undefined);

/* ---------- Writes ---------- */

/** Every admin read a product write can change: lists, inventory, taxonomy counts, overview, collections. */
export function invalidateProductCatalog(qc: QueryClient) {
  for (const key of [productsKey, ['admin', 'inventory'], ['admin', 'departments'], ['admin', 'dashboard'], ['admin', 'collections']])
    void qc.invalidateQueries({queryKey: key});
}

const productPath = (id: string) => `products/${encodeURIComponent(id)}`;

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminProductInput) => manage<AdminProduct>('products', {method: 'POST', body: input}),
    onSuccess: p => {
      qc.setQueryData(productQuery(p.id).queryKey, p);
      invalidateProductCatalog(qc);
    },
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AdminProductInput>) => manage<AdminProduct>(productPath(id), {method: 'PATCH', body: input}),
    onSuccess: p => {
      qc.setQueryData(productQuery(p.id).queryKey, p);
      invalidateProductCatalog(qc);
    },
  });
}

/** Resolves `{archived: true}` when the product had orders and the server archived it instead (DELETE answers 204 otherwise). */
const deleteProduct = (id: string) =>
  manage<{archived?: boolean} | null>(productPath(id), {method: 'DELETE'}).then(r => ({archived: Boolean(r?.archived)}));

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProduct,
    onSuccess: (res, id) => {
      if (!res.archived) qc.removeQueries({queryKey: productQuery(id).queryKey});
      invalidateProductCatalog(qc);
    },
  });
}

export function useDuplicateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => manage<AdminProduct>(`${productPath(id)}/duplicate`, {method: 'POST', body: {}}),
    onSuccess: p => {
      qc.setQueryData(productQuery(p.id).queryKey, p);
      invalidateProductCatalog(qc);
    },
  });
}

/** Runs `task` over `items`, at most `limit` at a time, settling every one (never rejects). */
async function settleAll<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = {status: 'fulfilled', value: await task(items[i] as T)};
      } catch (reason) {
        out[i] = {status: 'rejected', reason};
      }
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return out;
}

/** One action over several products (no bulk endpoint: ≤ 6 requests at a time, one cache refresh). */
export function useBulkProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ids, action}: {ids: string[]; action: ProductBulkAction}): Promise<ProductBulkResult> => {
      const settled = await settleAll(ids, 6, id =>
        action === 'delete'
          ? deleteProduct(id)
          : manage<AdminProduct>(productPath(id), {method: 'PATCH', body: action}).then(() => ({archived: false}))
      );
      const result: ProductBulkResult = {done: [], archived: [], failed: []};
      settled.forEach((r, i) => {
        const id = ids[i] as string;
        if (r.status === 'rejected') result.failed.push({id, error: r.reason});
        else if (r.value.archived) result.archived.push(id);
        else result.done.push(id);
      });
      return result;
    },
    onSettled: (result, _e, {action}) => {
      if (action === 'delete') for (const id of result?.done ?? []) qc.removeQueries({queryKey: productQuery(id).queryKey});
      invalidateProductCatalog(qc);
    },
  });
}
