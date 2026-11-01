import type {QueryClient} from '@tanstack/react-query';

/** CMS pages (`/dashboard/pages`, `/$id`). WP-07 owns this file (`/site-api/manage/pages`). */

/** WP-07 implements. */
export const loadPages = (_queryClient: QueryClient): Promise<void> => Promise.resolve();
/** WP-07 implements. `id` is `new` for a new page. */
export const loadPage = (_queryClient: QueryClient, _id: string): Promise<void> => Promise.resolve();
