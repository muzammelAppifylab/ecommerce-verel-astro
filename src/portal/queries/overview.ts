import {keepPreviousData, type QueryClient, queryOptions} from '@tanstack/react-query';

import type {AdminDashboard} from '../../lib/types/admin/analytics';
import {manage} from '../api';
import {parsePeriod, type Period, type RawSearch} from './search-params';

/**
 * Overview (VAREL's admin dashboard, `/dashboard/`). WP-16 owns this file: the reads
 * (`GET /site-api/manage/dashboard`, `/dashboard/counts`) and the loader. The shell
 * reads `navCountsQuery` for the sidebar counters (open orders, pending returns).
 * Every key starts `['admin', 'dashboard']`, so an order or return save that
 * invalidates that prefix (WP-19) refreshes the dashboard and the counters.
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

/** The counters from `GET /site-api/manage/dashboard/counts` (two capped counts in one statement). */
export async function fetchNavCounts(): Promise<NavCounts> {
  return manage<NavCounts>('dashboard/counts');
}

export const navCountsQuery = queryOptions({
  queryKey: ['admin', 'dashboard', 'nav-counts'],
  queryFn: fetchNavCounts,
  staleTime: 60_000,
});

/** The dashboard for a window (7, 30, 90 days or the lifetime). Switching keeps the old numbers dimmed. */
export const dashboardQuery = (days: Period = 30) =>
  queryOptions({
    queryKey: ['admin', 'dashboard', 'window', days],
    queryFn: ({signal}) => manage<AdminDashboard>('dashboard', {query: days === 30 ? {} : {days}, signal}),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

/** The abilities that open any store area (the dashboard route lets in staff of any area). */
export const STORE_ABILITIES = [
  'manageOrders',
  'manageCustomers',
  'manageProducts',
  'manageContent',
  'manageDiscounts',
  'viewAnalytics',
  'manageStoreSettings',
  'manageUsers',
] as const;

/** True when `/me` abilities open at least one store area (else the dashboard read would answer 403). */
export const hasStoreArea = (abilities: object | null | undefined) =>
  Boolean(abilities && STORE_ABILITIES.some(a => (abilities as Partial<Record<string, boolean>>)[a]));

/** Warm the overview's reads before it renders: only for the team (the route loader has read `/me` first). */
export const loadOverview = (queryClient: QueryClient, search: DashboardSearch): Promise<void> => {
  const me = queryClient.getQueryData<{abilities?: object}>(['me']);
  if (me && !hasStoreArea(me.abilities)) return Promise.resolve();
  return queryClient.ensureQueryData(dashboardQuery(search.days ?? 30)).then(
    () => undefined,
    () => undefined
  );
};
