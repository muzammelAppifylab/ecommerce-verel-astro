import {infiniteQueryOptions, keepPreviousData, type QueryClient, queryOptions} from '@tanstack/react-query';

import type {CursorPage} from '../../lib/types/admin/common';
import type {AdminCustomer, AdminCustomerRow} from '../../lib/types/admin/customers';
import {ApiError, manage} from '../api';
import {clean, listOf, oneOf, type RawSearch, str} from './search-params';

/**
 * Customers (`/dashboard/customers`, `/dashboard/customers/$id`). WP-20 owns this file
 * (`/site-api/manage/customers`, src/server/routes/admin/customers.ts). Port of VAREL
 * `src/lib/admin/sales.ts` (customers): keyset pages instead of page numbers; mutations
 * live in the screens.
 */

/** VAREL's account roles; here derived from the template roles `member` (customer), `staff`, `admin`/`owner` (PLAN.md D5). */
export const CUSTOMER_ROLES = ['customer', 'staff', 'admin'] as const;
export type CustomerRole = (typeof CUSTOMER_ROLES)[number];
export const CUSTOMER_ROLE_LABEL: Record<CustomerRole, string> = {customer: 'Customer', staff: 'Staff', admin: 'Admin'};

/** The server's sorts (src/lib/types/admin/customers.ts `CUSTOMER_SORTS`): orders/spent sorts need totals, which keyset pages do not have. */
export const CUSTOMER_SORTS = ['createdAt', '-createdAt', 'email', '-email', 'name', '-name'] as const;
export const DEFAULT_CUSTOMER_SORT = '-createdAt';
export const CUSTOMER_PAGE_SIZE = 25;

export interface CustomersSearch {
  q?: string;
  role?: CustomerRole[];
  sort?: (typeof CUSTOMER_SORTS)[number];
}

export function validateCustomersSearch(raw: RawSearch): CustomersSearch {
  return clean({q: str(raw.q), role: listOf(raw.role, CUSTOMER_ROLES), sort: oneOf(raw.sort, CUSTOMER_SORTS)});
}

export const customerKeys = {
  all: ['admin', 'customers'] as const,
  list: (search: CustomersSearch) => ['admin', 'customers', 'list', search] as const,
  detail: (id: string) => ['admin', 'customers', 'detail', id] as const,
};

/** `/dashboard/customers`: keyset pages of 25. */
export const customersQuery = (search: CustomersSearch) =>
  infiniteQueryOptions({
    queryKey: customerKeys.list(search),
    initialPageParam: '',
    queryFn: ({pageParam, signal}) =>
      manage<CursorPage<AdminCustomerRow>>('customers', {
        query: {q: search.q, role: search.role, sort: search.sort, cursor: pageParam || undefined, pageSize: CUSTOMER_PAGE_SIZE},
        signal,
      }),
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

/** `/dashboard/customers/$id`: no retry on a 404 (the screen says there is no such customer). */
export const customerQuery = (id: string) =>
  queryOptions({
    queryKey: customerKeys.detail(id),
    queryFn: ({signal}) => manage<AdminCustomer>(`customers/${encodeURIComponent(id)}`, {signal}),
    retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 422)) && count < 2,
  });

export const loadCustomers = (queryClient: QueryClient, search: CustomersSearch): Promise<void> =>
  queryClient.ensureInfiniteQueryData(customersQuery(search)).then(() => undefined);

export const loadCustomer = (queryClient: QueryClient, id: string): Promise<void> =>
  queryClient.ensureQueryData(customerQuery(id)).then(() => undefined);
