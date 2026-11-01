import type {QueryClient} from '@tanstack/react-query';

import {clean, pageNum, type RawSearch, str} from './search-params';

/** Newsletter subscribers (`/dashboard/subscribers`). WP-20 owns this file (`/site-api/manage/subscribers`). */

export interface SubscribersSearch {
  q?: string;
  page?: number;
}

export function validateSubscribersSearch(raw: RawSearch): SubscribersSearch {
  return clean({q: str(raw.q), page: pageNum(raw.page)});
}

/** WP-20 implements. */
export const loadSubscribers = (_queryClient: QueryClient, _search: SubscribersSearch): Promise<void> => Promise.resolve();
