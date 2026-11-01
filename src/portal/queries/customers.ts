import type {QueryClient} from '@tanstack/react-query';

import {clean, listOf, oneOf, pageNum, type RawSearch, str} from './search-params';

/** Customers (`/dashboard/customers`, `/dashboard/customers/$id`). WP-20 owns this file (`/site-api/manage/customers`). */

/** VAREL's account roles; here the template roles `member` (customer), `staff`, `admin` (PLAN.md D5). */
export const CUSTOMER_ROLES = ['customer', 'staff', 'admin'] as const;
export const CUSTOMER_SORTS = ['createdAt', '-createdAt', 'spent', '-spent', 'orders', '-orders'] as const;

export interface CustomersSearch {
  q?: string;
  role?: (typeof CUSTOMER_ROLES)[number][];
  sort?: (typeof CUSTOMER_SORTS)[number];
  page?: number;
}

export function validateCustomersSearch(raw: RawSearch): CustomersSearch {
  return clean({q: str(raw.q), role: listOf(raw.role, CUSTOMER_ROLES), sort: oneOf(raw.sort, CUSTOMER_SORTS), page: pageNum(raw.page)});
}

/** WP-20 implements. */
export const loadCustomers = (_queryClient: QueryClient, _search: CustomersSearch): Promise<void> => Promise.resolve();
/** WP-20 implements. */
export const loadCustomer = (_queryClient: QueryClient, _id: string): Promise<void> => Promise.resolve();
