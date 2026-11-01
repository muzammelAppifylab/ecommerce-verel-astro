import type {QueryClient} from '@tanstack/react-query';

import {clean, isoDate, listOf, oneOf, pageNum, type RawSearch, str} from './search-params';

/** Orders (`/dashboard/orders`, `/dashboard/orders/$number`). WP-19 owns this file (`/site-api/manage/orders`). */

export const PAYMENT_STATUSES = ['Paid', 'Pending', 'Refunded', 'Failed'] as const;
export const FULFILLMENT_STATUSES = ['Unfulfilled', 'Processing', 'Shipped', 'Delivered', 'Returned', 'Cancelled'] as const;
export const ORDER_SORTS = ['placedAt', '-placedAt', 'total', '-total'] as const;

export interface OrdersSearch {
  q?: string;
  payment?: (typeof PAYMENT_STATUSES)[number][];
  fulfillment?: (typeof FULFILLMENT_STATUSES)[number][];
  /** YYYY-MM-DD */
  from?: string;
  to?: string;
  sort?: (typeof ORDER_SORTS)[number];
  page?: number;
}

export function validateOrdersSearch(raw: RawSearch): OrdersSearch {
  return clean({
    q: str(raw.q),
    payment: listOf(raw.payment, PAYMENT_STATUSES),
    fulfillment: listOf(raw.fulfillment, FULFILLMENT_STATUSES),
    from: isoDate(raw.from),
    to: isoDate(raw.to),
    sort: oneOf(raw.sort, ORDER_SORTS),
    page: pageNum(raw.page),
  });
}

/** WP-19 implements. */
export const loadOrders = (_queryClient: QueryClient, _search: OrdersSearch): Promise<void> => Promise.resolve();
/** WP-19 implements. `number` is the order number in the URL (`/dashboard/orders/1001`). */
export const loadOrder = (_queryClient: QueryClient, _number: string): Promise<void> => Promise.resolve();
