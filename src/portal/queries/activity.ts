import type {QueryClient} from '@tanstack/react-query';

import {clean, isoDate, pageNum, type RawSearch, str} from './search-params';

/**
 * Activity (`/dashboard/activity`). WP-26 owns this file (`/site-api/manage/activity`):
 * VAREL's store activity log, on top of the template's audit log screen.
 */

export interface ActivitySearch {
  q?: string;
  actor?: string;
  entity?: string;
  from?: string;
  to?: string;
  page?: number;
}

export function validateActivitySearch(raw: RawSearch): ActivitySearch {
  return clean({q: str(raw.q), actor: str(raw.actor), entity: str(raw.entity), from: isoDate(raw.from), to: isoDate(raw.to), page: pageNum(raw.page)});
}

/** WP-26 implements (the route also warms the template's audit log). */
export const loadActivity = (_queryClient: QueryClient, _search: ActivitySearch): Promise<void> => Promise.resolve();
