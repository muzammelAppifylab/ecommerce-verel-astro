import type {QueryClient} from '@tanstack/react-query';

/**
 * Staff (`/dashboard/staff`). WP-26 owns this file (`/site-api/manage/staff`),
 * on top of the template's Users and Roles screens.
 */

/** WP-26 implements. */
export const loadStaff = (_queryClient: QueryClient): Promise<void> => Promise.resolve();
