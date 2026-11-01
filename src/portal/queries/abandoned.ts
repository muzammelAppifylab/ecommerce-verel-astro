import {infiniteQueryOptions, keepPreviousData, type QueryClient} from '@tanstack/react-query';

import type {
  AbandonedBagRow,
  AbandonedBulkAction,
  AbandonedBulkResult,
  AbandonedList,
  AbandonedRunResult,
  AbandonedStatus,
} from '../../lib/types/admin/merchandising';
import {manage} from '../api';

/**
 * Abandoned bags (`/dashboard/abandoned`). WP-24 owns this file (`/site-api/manage/abandoned`).
 * Port of VAREL src/lib/admin/merchandising.ts (`useAbandonedBags`, `useSendReminder`,
 * `useBulkAbandoned`, `useRunAbandoned`): the list is a keyset-paged infinite query; the
 * mutations' fetchers live here, the `useMutation`s in the screen.
 */

export const ABANDONED_STATUSES = ['active', 'abandoned', 'reminded', 'superseded', 'dismissed', 'ordered'] as const satisfies readonly AbandonedStatus[];
export const ABANDONED_SORTS = ['lastActivity', '-lastActivity', 'value', '-value'] as const;
export type AbandonedSort = (typeof ABANDONED_SORTS)[number];
export type AbandonedFilter = 'all' | AbandonedStatus;

export interface AbandonedFilters {
  q: string;
  status: AbandonedFilter;
  sort: AbandonedSort;
}

/** The list's answer: `capped` when the server derived it from its newest SCAN_LIMIT bags only. */
export type AbandonedPage = AbandonedList & {capped?: boolean};
/** The run's answer (the job's per-outcome counts ride along). */
export type AbandonedRunReport = AbandonedRunResult & {outcomes?: Partial<Record<string, number>>};

export const ABANDONED_PAGE_SIZE = 25;
export const DEFAULT_ABANDONED_FILTERS: AbandonedFilters = {q: '', status: 'all', sort: '-lastActivity'};

export const abandonedKeys = {
  all: ['manage', 'abandoned'] as const,
  list: (f: AbandonedFilters) => ['manage', 'abandoned', 'list', f] as const,
};

export const abandonedListQuery = (f: AbandonedFilters) =>
  infiniteQueryOptions({
    queryKey: abandonedKeys.list(f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      manage<AbandonedPage>('abandoned', {
        query: {q: f.q || undefined, status: f.status, sort: f.sort, cursor: pageParam, pageSize: ABANDONED_PAGE_SIZE},
        signal,
      }),
    getNextPageParam: page => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

/** The route loader: warms the default list. */
export const loadAbandoned = (queryClient: QueryClient): Promise<void> =>
  queryClient.ensureInfiniteQueryData(abandonedListQuery(DEFAULT_ABANDONED_FILTERS)).then(() => undefined);

/** "Send reminder now" (forced): the bag's fresh row. */
export const sendAbandonedReminder = (id: string) =>
  manage<AbandonedBagRow>(`abandoned/${encodeURIComponent(id)}/remind`, {method: 'POST', body: {}});

export const bulkAbandoned = (ids: string[], action: AbandonedBulkAction) =>
  manage<AbandonedBulkResult>('abandoned/bulk', {method: 'POST', body: {ids, action}});

/** "Send due reminders": the scheduled job's work, now. */
export const runAbandoned = () => manage<AbandonedRunReport>('abandoned/run', {method: 'POST', body: {}});

/** The two settings this screen changes (WP-23's `PATCH /site-api/manage/settings` validates them). */
export const patchAbandonedSettings = (body: {abandonedCartEnabled?: boolean; abandonedCartHours?: number}) =>
  manage<unknown>('settings', {method: 'PATCH', body});
