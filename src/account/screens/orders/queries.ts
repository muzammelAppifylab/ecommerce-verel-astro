/* Data for the order screens (VAREL src/lib/api/hooks.ts useOrders / useOrder / useCancelOrder), through F4's
   storefront `api` (siteFetch: same-origin cookies, CSRF, one refresh on 401 token_expired, X-Locale). */
import {infiniteQueryOptions, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import {api, isApiError} from '@/lib/storefront-api';
import type {CursorPage} from '@/lib/types/common';
import type {CancelReason, Order, OrderStatusFilter} from '@/lib/types/orders';
import type {PublicSettings} from '@/lib/types/settings';

/** Orders per history page (the server allows up to 50). */
export const ORDERS_PAGE_SIZE = 20;

const noRetryOn = (codes: number[]) => (count: number, err: unknown) =>
  !(isApiError(err) && codes.includes(err.status)) && count < 2;

/** Order history, one keyset page at a time. Key `['orders', status | 'all']`. */
export const ordersInfiniteQuery = (status?: OrderStatusFilter) =>
  infiniteQueryOptions({
    queryKey: ['orders', status ?? 'all'] as const,
    queryFn: ({pageParam, signal}) =>
      api.get<CursorPage<Order>>('/orders', {status, cursor: pageParam, pageSize: ORDERS_PAGE_SIZE}, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: CursorPage<Order>) => page.nextCursor ?? undefined,
    retry: noRetryOn([401, 403, 422]),
  });

/** One order. Key `['order', number]`. */
export const orderQuery = (number: string) =>
  queryOptions({
    queryKey: ['order', number] as const,
    queryFn: ({signal}) => api.get<Order>(`/orders/${encodeURIComponent(number)}`, undefined, signal),
    retry: noRetryOn([401, 403, 404]),
  });

/** Store name, legal details and return reasons (invoice, returns). Key `['settings', 'public']`. */
export const publicSettingsQuery = () =>
  queryOptions({
    queryKey: ['settings', 'public'] as const,
    queryFn: ({signal}) => api.get<PublicSettings>('/settings/public', undefined, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });

/** Cancel an order (POST /orders/:number/cancel). On success the order view updates in place, the lists and the
    account overview (WP-13 key `['account', 'overview']`) reload. */
export function useCancelOrder(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: CancelReason) =>
      api.post<Order>(`/orders/${encodeURIComponent(number)}/cancel`, reason ? {reason} : {}),
    onSuccess: order => {
      qc.setQueryData(['order', number], order);
      void qc.invalidateQueries({queryKey: ['orders']});
      void qc.invalidateQueries({queryKey: ['account', 'overview']});
    },
  });
}
