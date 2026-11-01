import {infiniteQueryOptions, keepPreviousData, type QueryClient, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {AdminOrder, AdminOrderRow, AdminOrderUpdate} from '../../lib/types/admin/sales';
import type {CursorPage} from '../../lib/types/common';
import {ApiError, manage} from '../api';
import {clean, isoDate, listOf, oneOf, type RawSearch, str} from './search-params';

/**
 * Orders (`/dashboard/orders`, `/dashboard/orders/$number`), port of VAREL `src/lib/admin/sales.ts`
 * (orders part). WP-19 owns this file; the server is `/site-api/manage/orders` (src/server/routes/admin/orders.ts).
 * Lists are keyset-paged (`CursorPage`, "Load more"); there are no page numbers or totals.
 */

export const PAYMENT_STATUSES = ['Paid', 'Pending', 'Refunded', 'Failed'] as const;
export const FULFILLMENT_STATUSES = ['Unfulfilled', 'Processing', 'Shipped', 'Delivered', 'Returned', 'Cancelled'] as const;
export const ORDER_SORTS = ['placedAt', '-placedAt', 'total', '-total'] as const;

/** Rows per keyset page (VAREL PAGE_SIZE). */
export const ORDERS_PAGE_SIZE = 25;

export interface OrdersSearch {
  q?: string;
  payment?: (typeof PAYMENT_STATUSES)[number][];
  fulfillment?: (typeof FULFILLMENT_STATUSES)[number][];
  /** YYYY-MM-DD */
  from?: string;
  to?: string;
  sort?: (typeof ORDER_SORTS)[number];
}

/** VAREL's validator, without `page` (keyset paging). Malformed values are dropped. */
export function validateOrdersSearch(raw: RawSearch): OrdersSearch {
  return clean({
    q: str(raw.q),
    payment: listOf(raw.payment, PAYMENT_STATUSES),
    fulfillment: listOf(raw.fulfillment, FULFILLMENT_STATUSES),
    from: isoDate(raw.from),
    to: isoDate(raw.to),
    sort: oneOf(raw.sort, ORDER_SORTS),
  });
}

/* ---------- Query keys (VAREL salesKeys, kept so other screens' invalidations keep working) ---------- */

export const salesKeys = {
  orders: ['admin', 'orders'] as const,
  orderList: (s: OrdersSearch) => ['admin', 'orders', 'list', s] as const,
  order: (number: string) => ['admin', 'orders', 'detail', number] as const,
  returns: ['admin', 'returns'] as const,
  returnList: (s: object) => ['admin', 'returns', 'list', s] as const,
  return: (id: string) => ['admin', 'returns', 'detail', id] as const,
  customers: ['admin', 'customers'] as const,
  dashboard: ['admin', 'dashboard'] as const,
};

/** The list filters as the server reads them. The date inputs are local calendar days: send inclusive ISO bounds. */
export function ordersQuery(s: OrdersSearch) {
  return {
    q: s.q,
    payment: s.payment,
    fulfillment: s.fulfillment,
    from: s.from ? new Date(`${s.from}T00:00:00`).toISOString() : undefined,
    to: s.to ? new Date(`${s.to}T23:59:59.999`).toISOString() : undefined,
    sort: s.sort,
  };
}

/** True when any filter (not the sort) is set. */
export const ordersFiltered = (s: OrdersSearch) => Boolean(s.q || s.payment?.length || s.fulfillment?.length || s.from || s.to);

/* ---------- Orders ---------- */

export const ordersListQuery = (s: OrdersSearch) =>
  infiniteQueryOptions({
    queryKey: salesKeys.orderList(s),
    initialPageParam: '',
    queryFn: ({pageParam, signal}) =>
      manage<CursorPage<AdminOrderRow>>('orders', {
        query: {...ordersQuery(s), cursor: pageParam || undefined, pageSize: ORDERS_PAGE_SIZE},
        signal,
      }),
    getNextPageParam: page => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

/** A missing record is an answer (the screen shows it), not something to retry. */
export const retryUnlessMissing = (count: number, error: unknown) => !(error instanceof ApiError && error.status === 404) && count < 2;

export const orderQuery = (number: string) =>
  queryOptions({
    queryKey: salesKeys.order(number),
    queryFn: ({signal}) => manage<AdminOrder>(`orders/${encodeURIComponent(number)}`, {signal}),
    retry: retryUnlessMissing,
  });

/** Warm the list before the screen renders (route loader). Never throws: the screen shows the error. */
export const loadOrders = (queryClient: QueryClient, search: OrdersSearch): Promise<void> =>
  queryClient.ensureInfiniteQueryData(ordersListQuery(search)).then(
    () => undefined,
    () => undefined
  );

/** `number` is the order number in the URL (`/dashboard/orders/VRL-24817`). Never throws (a 404 renders in the screen). */
export const loadOrder = (queryClient: QueryClient, number: string): Promise<void> =>
  queryClient.ensureQueryData(orderQuery(number)).then(
    () => undefined,
    () => undefined
  );

export function afterOrderChange(qc: QueryClient, order: AdminOrder) {
  qc.setQueryData(salesKeys.order(order.number), order);
  void qc.invalidateQueries({queryKey: [...salesKeys.orders, 'list']});
  void qc.invalidateQueries({queryKey: salesKeys.returns});
  void qc.invalidateQueries({queryKey: salesKeys.customers});
  void qc.invalidateQueries({queryKey: salesKeys.dashboard});
}

export const patchOrder = (number: string, body: AdminOrderUpdate) =>
  manage<AdminOrder>(`orders/${encodeURIComponent(number)}`, {method: 'PATCH', body});

export function useUpdateOrder(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminOrderUpdate) => patchOrder(number, body),
    onSuccess: order => afterOrderChange(qc, order),
  });
}

export interface BulkOrdersResult {
  updated: AdminOrder[];
  failed: {number: string; error: unknown}[];
}

/** Runs `work` over `items`, at most `limit` at a time; results in input order. */
export async function settleLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = {status: 'fulfilled', value: await work(items[i]!)};
      } catch (reason) {
        out[i] = {status: 'rejected', reason};
      }
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, lane));
  return out;
}

/** The same update applied to several orders (no bulk endpoint: PATCHes, 5 at a time, one cache refresh). */
export function useBulkUpdateOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({numbers, body}: {numbers: string[]; body: AdminOrderUpdate}): Promise<BulkOrdersResult> => {
      const settled = await settleLimited(numbers, 5, n => patchOrder(n, body));
      const result: BulkOrdersResult = {updated: [], failed: []};
      settled.forEach((r, i) =>
        r.status === 'fulfilled' ? result.updated.push(r.value) : result.failed.push({number: numbers[i]!, error: r.reason})
      );
      return result;
    },
    onSettled: result => {
      for (const o of result?.updated ?? []) qc.setQueryData(salesKeys.order(o.number), o);
      void qc.invalidateQueries({queryKey: [...salesKeys.orders, 'list']});
      void qc.invalidateQueries({queryKey: salesKeys.customers});
      void qc.invalidateQueries({queryKey: salesKeys.dashboard});
    },
  });
}

export function useRefundOrder(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {restock: boolean; note?: string}) =>
      manage<AdminOrder>(`orders/${encodeURIComponent(number)}/refund`, {method: 'POST', body}),
    onSuccess: order => {
      afterOrderChange(qc, order);
      // Restocking changes inventory and product stock states.
      void qc.invalidateQueries({queryKey: ['admin', 'inventory']});
      void qc.invalidateQueries({queryKey: ['admin', 'products']});
    },
  });
}

/** An error's message for a toast or a dialog. */
export const salesErrorText = (error: unknown) => (error instanceof Error ? error.message : 'That did not work. Try again.');
