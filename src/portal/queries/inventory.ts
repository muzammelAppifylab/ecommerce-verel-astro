import type {QueryClient} from '@tanstack/react-query';

import {clean, listOf, pageNum, type RawSearch, str} from './search-params';

/** Inventory (`/dashboard/inventory`). WP-18 owns this file (`/site-api/manage/inventory`). */

export const INVENTORY_STATES = ['in', 'low', 'out'] as const;

export interface InventorySearch {
  q?: string;
  state?: (typeof INVENTORY_STATES)[number][];
  page?: number;
}

export function validateInventorySearch(raw: RawSearch): InventorySearch {
  return clean({q: str(raw.q), state: listOf(raw.state, INVENTORY_STATES), page: pageNum(raw.page)});
}

/** WP-18 implements. */
export const loadInventory = (_queryClient: QueryClient, _search: InventorySearch): Promise<void> => Promise.resolve();
