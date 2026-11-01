import {type QueryClient, queryOptions} from '@tanstack/react-query';

import type {AdminPage, AdminPageInput, AdminPageRow} from '../../lib/types/admin/content';
import {manage} from '../api';

/**
 * CMS pages (`/dashboard/pages`, `/$id`). WP-07 owns this file (`/site-api/manage/pages`).
 * Port of VAREL `src/lib/admin/cms.ts` (pages part).
 */

export const pagesKeys = {
  all: ['manage', 'pages'] as const,
  page: (id: string) => ['manage', 'pages', id] as const,
};

/** Every editable page (≤ 100, no bodies). */
export const pagesQuery = queryOptions({
  queryKey: pagesKeys.all,
  queryFn: ({signal}) => manage<AdminPageRow[]>('pages', {signal}),
});

export const pageQuery = (id: string) =>
  queryOptions({
    queryKey: pagesKeys.page(id),
    queryFn: ({signal}) => manage<AdminPage>(`pages/${encodeURIComponent(id)}`, {signal}),
  });

export const updatePage = (id: string, body: Partial<AdminPageInput>) => manage<AdminPage>(`pages/${encodeURIComponent(id)}`, {method: 'PATCH', body});
export const deletePage = (id: string) => manage<null>(`pages/${encodeURIComponent(id)}`, {method: 'DELETE'});

export const loadPages = (queryClient: QueryClient): Promise<void> => queryClient.ensureQueryData(pagesQuery).then(() => undefined);
/** `id` is `new` for a new page: VAREL creates pages in code, so the editor sends it back to the list. */
export const loadPage = (queryClient: QueryClient, id: string): Promise<void> =>
  id === 'new' ? Promise.resolve() : queryClient.ensureQueryData(pageQuery(id)).then(() => undefined);
