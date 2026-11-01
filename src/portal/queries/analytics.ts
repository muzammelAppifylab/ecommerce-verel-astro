import type {QueryClient} from '@tanstack/react-query';

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

/** WP-16 implements. */
export const loadAnalytics = (_queryClient: QueryClient, _search: AnalyticsSearch): Promise<void> => Promise.resolve();
