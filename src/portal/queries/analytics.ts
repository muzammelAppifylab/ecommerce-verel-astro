import {keepPreviousData, type QueryClient, queryOptions} from '@tanstack/react-query';

import type {AdminAnalytics} from '../../lib/types/admin/analytics';
import type {StoreSettings} from '../../lib/types/admin/store';
import {manage} from '../api';
import {isoDate, parsePeriod, type RawSearch} from './search-params';

/** Analytics (`/dashboard/analytics`). WP-16 owns this file (`GET /site-api/manage/analytics`). */

/** A custom from/to range wins over the `days` preset; neither means the last 30 days. */
export interface AnalyticsSearch {
  days?: 7 | 90 | 'all';
  from?: string;
  to?: string;
}

export function validateAnalyticsSearch(raw: RawSearch): AnalyticsSearch {
  const from = isoDate(raw.from);
  const to = isoDate(raw.to);
  const days = from || to ? undefined : parsePeriod(raw.days);
  return {...(days ? {days} : {}), ...(from ? {from} : {}), ...(to ? {to} : {})};
}

/** The report for a preset or a custom range. Switching keeps the old numbers on screen until the new ones land. */
export const analyticsQuery = (s: AnalyticsSearch) =>
  queryOptions({
    queryKey: ['admin', 'analytics', s.from ?? '', s.to ?? '', s.days ?? 30],
    queryFn: ({signal}) =>
      manage<AdminAnalytics>('analytics', {
        query: {from: s.from, to: s.to, days: s.days === undefined ? undefined : String(s.days)},
        signal,
      }),
    placeholderData: keepPreviousData,
  });

/**
 * The store settings the reports need (currency, whether visitor analytics is on): `GET /site-api/manage/settings`
 * (WP-23; reads open to all staff). Under `['admin', 'settings']`, so a settings save there refreshes it. Until
 * that route answers, the screens fall back to USD and hide the "analytics is off" notice.
 */
export const reportSettingsQuery = queryOptions({
  queryKey: ['admin', 'settings', 'report'],
  queryFn: ({signal}) => manage<Pick<StoreSettings, 'currency' | 'analyticsEnabled'>>('settings', {signal}),
  staleTime: 60_000,
  retry: false,
});

export const loadAnalytics = (queryClient: QueryClient, search: AnalyticsSearch): Promise<void> =>
  Promise.all([
    queryClient.ensureQueryData(analyticsQuery(search)).catch(() => undefined),
    queryClient.prefetchQuery(reportSettingsQuery),
  ]).then(() => undefined);
