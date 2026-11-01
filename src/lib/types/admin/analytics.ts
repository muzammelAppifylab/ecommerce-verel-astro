/* Admin overview and analytics (VAREL src/lib/admin/types.ts, reviews.ts).
   Routes: /site-api/manage/dashboard, /manage/analytics (WP-16). */
import type { InventoryRow } from './catalog'
import type { AdminOrderRow } from './sales'

export interface AdminDashboard {
  periodDays: number // 7, 30, 90 or the lifetime's length; the *30d fields cover this window
  lifetime: boolean // since the first order; the *Prev30d fields are 0
  since: string // ISO date the window starts
  salesBucket: 'day' | 'month' // salesByDay holds months (dated the 1st) beyond 92 days
  revenue30d: number
  revenuePrev30d: number
  orders30d: number
  ordersPrev30d: number
  averageOrder30d: number
  customers: number
  newCustomers30d: number
  openOrders: number // Unfulfilled + Processing
  pendingReturns: number
  salesByDay: { date: string; total: number; orders: number }[] // one per salesBucket, ISO date, oldest first
  topProducts: { productId: string; name: string; units: number; revenue: number }[]
  lowStock: InventoryRow[] // low or out, max 10
  recentOrders: AdminOrderRow[] // max 8
}

export interface AdminAnalytics {
  from: string
  to: string
  days: number
  lifetime: boolean
  /** revenueByDay holds months (dated the 1st) when the range is longer than 92 days */
  bucket: 'day' | 'month'
  totals: {
    sessions: number
    pageViews: number
    productViews: number
    orders: number
    revenue: number
    averageOrder: number
    conversionRate: number
  }
  funnel: { key: string; label: string; count: number }[]
  revenueByDay: { date: string; total: number; orders: number }[]
  revenueByDepartment: { name: string; revenue: number; units: number }[]
  revenueByCategory: { name: string; department: string; revenue: number; units: number }[]
  topProducts: { productId: string; name: string; views: number; addToBag: number }[]
  topSearches: { query: string; count: number; avgResults: number }[]
  noResultSearches: { query: string; count: number; lastSearched: string }[]
}

/** `?days=7|30|90|all` or `?from=&to=` (YYYY-MM-DD) on both routes */
export interface AnalyticsSearch {
  days?: 7 | 30 | 90 | 'all'
  from?: string
  to?: string
}
