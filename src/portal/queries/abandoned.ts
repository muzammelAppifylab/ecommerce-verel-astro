import type {QueryClient} from '@tanstack/react-query';

/** Abandoned bags (`/dashboard/abandoned`). WP-24 owns this file (`/site-api/manage/abandoned`). */

/** WP-24 implements. */
export const loadAbandoned = (_queryClient: QueryClient): Promise<void> => Promise.resolve();
