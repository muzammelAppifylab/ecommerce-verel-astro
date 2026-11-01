import {infiniteQueryOptions, keepPreviousData, type QueryClient} from '@tanstack/react-query';

import type {CursorPage} from '../../lib/types/admin/common';
import type {AdminSubscriber} from '../../lib/types/admin/customers';
import {manage} from '../api';
import {clean, type RawSearch, str} from './search-params';

/**
 * Newsletter subscribers (`/dashboard/subscribers`). WP-20 owns this file
 * (`/site-api/manage/subscribers`, src/server/routes/admin/subscribers.ts). Port of VAREL
 * `src/lib/admin/content.ts` (subscribers) and `pages/admin/subscribers/search.ts`: keyset
 * pages of 50 (VAREL `PAGE_SIZE`) instead of page numbers.
 */

export const SUBSCRIBER_PAGE_SIZE = 50;

export interface SubscribersSearch {
  q?: string;
}

export function validateSubscribersSearch(raw: RawSearch): SubscribersSearch {
  return clean({q: str(raw.q)});
}

export const subscriberKeys = {
  all: ['admin', 'subscribers'] as const,
  list: (search: SubscribersSearch) => ['admin', 'subscribers', 'list', {q: search.q}] as const,
};

export const subscribersQuery = (search: SubscribersSearch) =>
  infiniteQueryOptions({
    queryKey: subscriberKeys.list(search),
    initialPageParam: '',
    queryFn: ({pageParam, signal}) =>
      manage<CursorPage<AdminSubscriber>>('subscribers', {
        query: {q: search.q, cursor: pageParam || undefined, pageSize: SUBSCRIBER_PAGE_SIZE},
        signal,
      }),
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const loadSubscribers = (queryClient: QueryClient, search: SubscribersSearch): Promise<void> =>
  queryClient.ensureInfiniteQueryData(subscribersQuery(search)).then(() => undefined);

