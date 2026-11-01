/* Admin customers and newsletter subscribers (VAREL src/lib/admin/types.ts, sales.ts, content.ts).
   Routes: /site-api/manage/customers, /manage/subscribers (WP-20). Customers are template users with a
   `CustomerProfile` (D5); role changes happen in the template's Users screen. */
import type { Address } from '../account'
import type { ListParams, Role } from './common'
import type { AdminOrderRow } from './sales'

export interface AdminCustomerRow {
  id: string // template user id
  name: string
  email: string
  role: Role
  since: string // "March 2024"
  createdAt: string
  orders: number
  spent: number
  lastOrderAt: string | null
  newsletter: boolean
}

export interface AdminCustomer extends AdminCustomerRow {
  phone: string | null
  addresses: Address[]
  recentOrders: AdminOrderRow[]
  wishlistCount: number
}

export const CUSTOMER_SORTS = ['name', '-name', 'email', '-email', 'createdAt', '-createdAt'] as const

export interface CustomersSearch extends ListParams {
  role?: Role[]
}

export interface AdminSubscriber {
  email: string
  source: string | null
  createdAt: string
}

export type SubscriberListParams = ListParams
