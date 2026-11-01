import {infiniteQueryOptions, keepPreviousData, type QueryClient, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {AdminReturn, AdminReturnRow, ReturnStatus} from '../../lib/types/admin/sales';
import type {CursorPage} from '../../lib/types/common';
import {manage} from '../api';
import {ORDERS_PAGE_SIZE, retryUnlessMissing, salesKeys, settleLimited} from './orders';
import {clean, listOf, type RawSearch, str} from './search-params';

/**
 * Returns (`/dashboard/returns`, `/dashboard/returns/$id`), port of VAREL `src/lib/admin/sales.ts`
 * (returns part). WP-19 owns this file; the server is `/site-api/manage/returns` (src/server/routes/admin/returns.ts).
 */

export const RETURN_STATUSES = ['Requested', 'Approved', 'Rejected', 'Received', 'Refunded'] as const;

export interface ReturnsSearch {
  q?: string;
  status?: (typeof RETURN_STATUSES)[number][];
}

/** VAREL's validator, without `page` (keyset paging). */
export function validateReturnsSearch(raw: RawSearch): ReturnsSearch {
  return clean({q: str(raw.q), status: listOf(raw.status, RETURN_STATUSES)});
}

/** Moves a return may make next. Mirrors RETURN_NEXT in src/server/routes/admin/returns.ts (a unit test asserts it). */
export const RETURN_NEXT: Record<ReturnStatus, ReturnStatus[]> = {
  Requested: ['Approved', 'Rejected'],
  Approved: ['Received', 'Refunded', 'Rejected'],
  Received: ['Refunded'],
  Rejected: ['Requested'],
  Refunded: [],
};

export const returnsListQuery = (s: ReturnsSearch) =>
  infiniteQueryOptions({
    queryKey: salesKeys.returnList(s),
    initialPageParam: '',
    queryFn: ({pageParam, signal}) =>
      manage<CursorPage<AdminReturnRow>>('returns', {
        query: {q: s.q, status: s.status, cursor: pageParam || undefined, pageSize: ORDERS_PAGE_SIZE},
        signal,
      }),
    getNextPageParam: page => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const returnQuery = (id: string) =>
  queryOptions({
    queryKey: salesKeys.return(id),
    queryFn: ({signal}) => manage<AdminReturn>(`returns/${encodeURIComponent(id)}`, {signal}),
    retry: retryUnlessMissing,
  });

/** Route loader: never throws (the screen shows errors). */
export const loadReturns = (queryClient: QueryClient, search: ReturnsSearch): Promise<void> =>
  queryClient.ensureInfiniteQueryData(returnsListQuery(search)).then(
    () => undefined,
    () => undefined
  );

/** Route loader: never throws (a 404 renders in the screen). */
export const loadReturn = (queryClient: QueryClient, id: string): Promise<void> =>
  queryClient.ensureQueryData(returnQuery(id)).then(
    () => undefined,
    () => undefined
  );

function afterReturnChange(qc: QueryClient, refunded: boolean) {
  void qc.invalidateQueries({queryKey: [...salesKeys.returns, 'list']});
  void qc.invalidateQueries({queryKey: salesKeys.orders});
  void qc.invalidateQueries({queryKey: salesKeys.customers});
  void qc.invalidateQueries({queryKey: salesKeys.dashboard});
  if (refunded) {
    void qc.invalidateQueries({queryKey: ['admin', 'inventory']});
    void qc.invalidateQueries({queryKey: ['admin', 'products']});
  }
}

export const patchReturn = (id: string, body: {status: ReturnStatus; note?: string}) =>
  manage<AdminReturn>(`returns/${encodeURIComponent(id)}`, {method: 'PATCH', body});

export function useUpdateReturn(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {status: ReturnStatus; note?: string}) => patchReturn(id, body),
    onSuccess: ret => {
      qc.setQueryData(salesKeys.return(id), ret);
      afterReturnChange(qc, ret.status === 'Refunded');
    },
  });
}

export interface BulkReturnsResult {
  updated: AdminReturn[];
  failed: {id: string; error: unknown}[];
}

/** One status move for several returns (PATCHes, 5 at a time, one refresh). */
export function useBulkUpdateReturns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ids, status, note}: {ids: string[]; status: ReturnStatus; note?: string}): Promise<BulkReturnsResult> => {
      const settled = await settleLimited(ids, 5, id => patchReturn(id, {status, note}));
      const result: BulkReturnsResult = {updated: [], failed: []};
      settled.forEach((r, i) => (r.status === 'fulfilled' ? result.updated.push(r.value) : result.failed.push({id: ids[i]!, error: r.reason})));
      return result;
    },
    onSettled: (result, _error, vars) => {
      for (const r of result?.updated ?? []) qc.setQueryData(salesKeys.return(r.id), r);
      afterReturnChange(qc, vars.status === 'Refunded');
    },
  });
}
