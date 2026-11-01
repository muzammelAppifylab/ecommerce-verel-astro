import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import type {InventoryChange, InventoryRow} from '../../lib/types/admin/catalog';
import type {CursorPage} from '../../lib/types/common';
import {manage} from '../api';
import {clean, listOf, type RawSearch, str} from './search-params';

/**
 * Inventory (`/dashboard/inventory`). WP-18 owns this file (`/site-api/manage/inventory`).
 * Port of VAREL `src/lib/admin/products.ts` (inventory part) and `products/search.ts`
 * (`validateInventorySearch`). Keyset pages (`useInfiniteQuery` + `LoadMore`), so `?page=`
 * is gone: an old link with it simply drops it.
 */

export const INVENTORY_STATES = ['in', 'low', 'out'] as const;
export type InventoryState = (typeof INVENTORY_STATES)[number];

/** Rows per page (VAREL showed 50). */
export const INVENTORY_PAGE = 50;
/** The store default, used for a row's state between an optimistic edit and the server's answer. */
export const INVENTORY_DEFAULT_LOW_STOCK = 6;

export interface InventorySearch {
  q?: string;
  state?: InventoryState[];
}

export function validateInventorySearch(raw: RawSearch): InventorySearch {
  return clean({q: str(raw.q), state: listOf(raw.state, INVENTORY_STATES)});
}

export const inventoryKeys = {
  all: ['admin', 'inventory'] as const,
  list: (s: InventorySearch) => ['admin', 'inventory', 'list', {q: s.q ?? '', state: s.state ?? []}] as const,
};

export const inventoryQuery = (s: InventorySearch) =>
  infiniteQueryOptions({
    queryKey: inventoryKeys.list(s),
    queryFn: ({pageParam, signal}) =>
      manage<CursorPage<InventoryRow>>('inventory', {
        query: {q: s.q, state: s.state, cursor: pageParam || undefined, pageSize: INVENTORY_PAGE},
        signal,
      }),
    initialPageParam: '',
    getNextPageParam: (page: CursorPage<InventoryRow>) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const loadInventory = (queryClient: QueryClient, search: InventorySearch): Promise<void> =>
  queryClient.ensureInfiniteQueryData(inventoryQuery(search)).then(() => undefined);

/** Per-variant stock state, as the server computes it (VAREL `variantState`). */
export const inventoryStateOf = (inventory: number, lowStock = INVENTORY_DEFAULT_LOW_STOCK): InventoryRow['state'] =>
  inventory <= 0 ? 'out' : inventory <= lowStock ? 'low' : 'in';

type InventoryPages = InfiniteData<CursorPage<InventoryRow>, string>;

/** Every cached inventory page with one row replaced. */
function patchRows(queryClient: QueryClient, variantId: string, map: (row: InventoryRow) => InventoryRow) {
  queryClient.setQueriesData<InventoryPages>({queryKey: inventoryKeys.all}, data =>
    data
      ? {...data, pages: data.pages.map(page => ({...page, items: page.items.map(row => (row.variantId === variantId ? map(row) : row))}))}
      : data
  );
}

/** Other screens that show stock: the products list and the overview's low-stock panel. */
function invalidateStockReaders(queryClient: QueryClient) {
  void queryClient.invalidateQueries({queryKey: ['admin', 'products']});
  void queryClient.invalidateQueries({queryKey: ['admin', 'dashboard']});
}

/** `PATCH /inventory/:sku` with an optimistic row (rolled back on error). */
export function useUpdateInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({variantId, ...body}: InventoryChange) =>
      manage<InventoryRow>(`inventory/${encodeURIComponent(variantId)}`, {method: 'PATCH', body}),
    onMutate: async (change: InventoryChange) => {
      await queryClient.cancelQueries({queryKey: inventoryKeys.all});
      const before = queryClient.getQueriesData<InventoryPages>({queryKey: inventoryKeys.all});
      patchRows(queryClient, change.variantId, row => {
        const inventory = 'inventory' in change ? change.inventory : Math.max(0, row.inventory + change.adjust);
        return {...row, inventory, state: inventoryStateOf(inventory)};
      });
      return {before};
    },
    onError: (_error, _change, context) => {
      for (const [key, data] of context?.before ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: row => {
      patchRows(queryClient, row.variantId, () => row);
      invalidateStockReaders(queryClient);
    },
  });
}

/** `POST /inventory/bulk`: every count lands or none does. */
export function useBulkInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: {variantId: string; inventory: number}[]) =>
      manage<{updated: number}>('inventory/bulk', {method: 'POST', body: {updates}}),
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: inventoryKeys.all});
      invalidateStockReaders(queryClient);
    },
  });
}
