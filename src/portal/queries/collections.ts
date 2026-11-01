import type {QueryClient} from '@tanstack/react-query';

/**
 * Collections (`/dashboard/collections`, `/$id`, `/category-order`). WP-05 owns
 * this file (`/site-api/manage/collections`).
 */

/** WP-05 implements. */
export const loadCollections = (_queryClient: QueryClient): Promise<void> => Promise.resolve();
/** WP-05 implements. `id` is `new` for a new collection. */
export const loadCollection = (_queryClient: QueryClient, _id: string): Promise<void> => Promise.resolve();
/** WP-05 implements. */
export const loadCategoryOrder = (_queryClient: QueryClient): Promise<void> => Promise.resolve();
