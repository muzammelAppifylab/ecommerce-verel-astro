/* Admin orders and returns (VAREL src/lib/admin/types.ts, sales.ts).
   Routes: /site-api/manage/orders, /manage/returns (WP-19). */
import type { FulfillmentStatus, Order, PaymentStatus } from '../orders'
import type { ListParams } from './common'

export type { FulfillmentStatus, PaymentStatus }

export interface AdminOrderRow {
  number: string
  placedAt: string
  date: string
  customerName: string
  email: string
  customerId: string | null // null for guest orders
  payment: PaymentStatus
  fulfillment: FulfillmentStatus
  total: number
  count: number
  currency?: string
}

export interface OrderEvent {
  at: string // ISO
  kind: 'placed' | 'status' | 'tracking' | 'refund' | 'note' | 'return'
  message: string // "Marked as shipped · DHL Express JJD0099887766"
  by: string | null // staff name, null for system
}

export type ReturnStatus = 'Requested' | 'Approved' | 'Rejected' | 'Received' | 'Refunded'

export interface AdminReturnRow {
  id: string
  orderNumber: string
  email: string
  status: ReturnStatus
  createdAt: string
  itemCount: number
  amount: number // value of returned lines
}

export interface AdminReturn extends AdminReturnRow {
  items: {
    lineId: string
    name: string
    sku: string
    color: string | null
    size: string | null
    options: Record<string, string>
    qty: number
    price: number
    reason: string
  }[]
  note: string | null
  order: AdminOrderRow
}

export interface AdminOrder extends Order {
  customer: { id: string; name: string; email: string } | null
  note: string | null // internal staff note
  events: OrderEvent[] // newest first
  returns: AdminReturnRow[]
}

/** PATCH /site-api/manage/orders/:number */
export interface AdminOrderUpdate {
  fulfillment?: FulfillmentStatus
  stage?: 1 | 2 | 3 | 4
  carrier?: string | null
  tracking?: string | null
  trackingUrl?: string | null
  payment?: PaymentStatus
  note?: string | null
}

/** POST /site-api/manage/orders/:number/refund */
export interface RefundInput {
  restock: boolean
  note?: string
}

/** PATCH /site-api/manage/returns/:id */
export interface ReturnUpdate {
  status: ReturnStatus
  note?: string | null
}

export const ORDER_SORTS = ['placedAt', '-placedAt', 'number', '-number', 'total', '-total', 'email', '-email'] as const

export interface OrdersSearch extends ListParams {
  payment?: PaymentStatus[]
  fulfillment?: FulfillmentStatus[]
  from?: string // YYYY-MM-DD
  to?: string
}

export interface ReturnsSearch extends ListParams {
  status?: ReturnStatus[]
}

export interface BulkResult {
  updated: AdminOrder[]
  failed: { number: string; error: unknown }[]
}

export interface BulkReturnResult {
  updated: AdminReturn[]
  failed: { id: string; error: unknown }[]
}
