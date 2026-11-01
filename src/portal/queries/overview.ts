import {type QueryClient, queryOptions} from '@tanstack/react-query';

import {parsePeriod, type RawSearch} from './search-params';

/**
 * Overview (VAREL's admin dashboard, `/dashboard/`). WP-16 owns this file: it
 * fills the reads (`GET /site-api/manage/dashboard`) and the loader. The shell
 * reads `navCountsQuery` for the sidebar counters (open orders, pending returns).
 */

/** `?days=7|90|all` picks the dashboard window; 30 is the default and stays out of the URL. */
export interface DashboardSearch {
  days?: 7 | 90 | 'all';
}

export function validateDashboardSearch(raw: RawSearch): DashboardSearch {
  const days = parsePeriod(raw.days);
  return days ? {days} : {};
}

/** The sidebar's counters, shown beside Orders and Returns when above zero. */
export interface NavCounts {
  openOrders: number;
  pendingReturns: number;
}

/** WP-16 implements: the counts from the dashboard route (counters kept on write, never a count() per request). */
export async function fetchNavCounts(): Promise<NavCounts> {
  return {openOrders: 0, pendingReturns: 0};
}

export const navCountsQuery = queryOptions({
  queryKey: ['admin', 'dashboard', 'nav-counts'],
  queryFn: fetchNavCounts,
  staleTime: 60_000,
});

/** Warm the overview's reads before it renders. WP-16 implements. */
export const loadOverview = (_queryClient: QueryClient, _search: DashboardSearch): Promise<void> => Promise.resolve();
