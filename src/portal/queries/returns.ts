import type {QueryClient} from '@tanstack/react-query';

import {clean, listOf, pageNum, type RawSearch, str} from './search-params';

/** Returns (`/dashboard/returns`, `/dashboard/returns/$id`). WP-19 owns this file (`/site-api/manage/returns`). */

export const RETURN_STATUSES = ['Requested', 'Approved', 'Rejected', 'Received', 'Refunded'] as const;

export interface ReturnsSearch {
  q?: string;
  status?: (typeof RETURN_STATUSES)[number][];
  page?: number;
}

export function validateReturnsSearch(raw: RawSearch): ReturnsSearch {
  return clean({q: str(raw.q), status: listOf(raw.status, RETURN_STATUSES), page: pageNum(raw.page)});
}

/** WP-19 implements. */
export const loadReturns = (_queryClient: QueryClient, _search: ReturnsSearch): Promise<void> => Promise.resolve();
/** WP-19 implements. */
export const loadReturn = (_queryClient: QueryClient, _id: string): Promise<void> => Promise.resolve();
