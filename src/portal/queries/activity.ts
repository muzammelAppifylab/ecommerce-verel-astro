import {infiniteQueryOptions, keepPreviousData, type QueryClient} from '@tanstack/react-query';

import type {AdminActivityPage} from '../../lib/types/admin/staff';
import {api, read, toQueryString} from '../api';
import {clean, isoDate, oneOf, type RawSearch, str} from './search-params';

/**
 * Activity (`/dashboard/activity`). WP-26 owns this file (`/site-api/manage/activity`): VAREL's store activity
 * log (src/lib/admin/staff.ts), next to the template's audit log (the "Sign-ins and security" tab). Keyset pages:
 * there is no `page` any more; `tab` picks the log.
 */

export const ACTIVITY_TABS = ['store', 'security'] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

export interface ActivitySearch {
  q?: string;
  actor?: string;
  entity?: string;
  from?: string;
  to?: string;
  tab?: ActivityTab;
}

export function validateActivitySearch(raw: RawSearch): ActivitySearch {
  const actor = str(raw.actor);
  return clean({
    q: str(raw.q),
    actor: actor && /^[1-9]\d{0,9}$/.test(actor) ? actor : undefined,
    entity: str(raw.entity),
    from: isoDate(raw.from),
    to: isoDate(raw.to),
    tab: oneOf(raw.tab, ACTIVITY_TABS),
  });
}

/** VAREL ACTIVITY_PAGE_SIZE. */
export const ACTIVITY_PAGE_SIZE = 50;

export const activityKey = ['manage', 'activity'] as const;

/** The filters only (the tab is not part of the data). */
export const activityFilters = (s: ActivitySearch) => ({q: s.q, actor: s.actor, entity: s.entity, from: s.from, to: s.to});

export const activityQuery = (s: ActivitySearch) => {
  const f = activityFilters(s);
  return infiniteQueryOptions({
    queryKey: [...activityKey, f],
    initialPageParam: '',
    queryFn: ({pageParam}) =>
      read<AdminActivityPage>(
        api.manage.activity.$get({
          query: {
            q: f.q ?? '',
            actor: f.actor ?? '',
            entity: f.entity ?? '',
            entityId: '',
            from: f.from ?? '',
            to: f.to ?? '',
            cursor: pageParam,
            pageSize: String(ACTIVITY_PAGE_SIZE),
          },
        })
      ),
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
};

/** The route loader: warm the store log (the security tab warms the template's audit log itself). */
export const loadActivity = (queryClient: QueryClient, search: ActivitySearch): Promise<void> =>
  search.tab === 'security' ? Promise.resolve() : queryClient.ensureInfiniteQueryData(activityQuery(search)).then(() => undefined);

/** The CSV export of the same filters (downloaded through `siteFetch`, never a plain link). */
export const activityCsvPath = (s: ActivitySearch) => `/site-api/manage/activity/export.csv${toQueryString(activityFilters(s))}`;
