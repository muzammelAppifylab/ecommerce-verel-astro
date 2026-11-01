import type {QueryClient} from '@tanstack/react-query';

import type {RawSearch} from './search-params';

/** Discounts (`/dashboard/discounts`, `/new`, `/$id`). WP-21 owns this file (`/site-api/manage/discounts`). */

export const DISCOUNT_STATUSES = ['active', 'scheduled', 'expired', 'inactive', 'used_up'] as const;
export type DiscountStatus = (typeof DISCOUNT_STATUSES)[number];
export type DiscountMethod = 'code' | 'automatic';

export interface DiscountsSearch {
  method?: DiscountMethod;
  status?: DiscountStatus[];
  q?: string;
}

export function validateDiscountsSearch(raw: RawSearch): DiscountsSearch {
  const method = raw.method === 'code' || raw.method === 'automatic' ? raw.method : undefined;
  const list = typeof raw.status === 'string' ? raw.status.split(',') : Array.isArray(raw.status) ? raw.status.map(String) : [];
  const status = DISCOUNT_STATUSES.filter(s => list.includes(s));
  const q = typeof raw.q === 'string' && raw.q.trim() ? raw.q.trim().slice(0, 60) : undefined;
  return {method, status: status.length ? status : undefined, q};
}

export type DiscountEditorTab = 'settings' | 'codes' | 'report';
export interface DiscountEditSearch {
  tab?: Exclude<DiscountEditorTab, 'settings'>;
}

export function validateDiscountEditSearch(raw: RawSearch): DiscountEditSearch {
  return {tab: raw.tab === 'codes' || raw.tab === 'report' ? raw.tab : undefined};
}

export const DISCOUNT_PRESETS = ['order', 'products', 'bxgy', 'shipping'] as const;
export type DiscountPreset = (typeof DISCOUNT_PRESETS)[number];

export interface NewDiscountSearch {
  type?: DiscountPreset;
  /** Duplicate: id of the discount to copy. */
  from?: string;
}

export function validateNewDiscountSearch(raw: RawSearch): NewDiscountSearch {
  const type = DISCOUNT_PRESETS.find(p => p === raw.type);
  const from = typeof raw.from === 'string' && raw.from ? raw.from.slice(0, 80) : undefined;
  return {type, from};
}

/** WP-21 implements. */
export const loadDiscounts = (_queryClient: QueryClient, _search: DiscountsSearch): Promise<void> => Promise.resolve();
/** WP-21 implements (the copied discount when `from` is set). */
export const loadNewDiscount = (_queryClient: QueryClient, _search: NewDiscountSearch): Promise<void> => Promise.resolve();
/** WP-21 implements. */
export const loadDiscount = (_queryClient: QueryClient, _id: string): Promise<void> => Promise.resolve();
