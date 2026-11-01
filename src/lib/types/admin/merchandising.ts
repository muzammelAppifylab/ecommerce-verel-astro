/* Admin merchandising (docs/PHASE2-3.md §7, VAREL src/lib/admin/merchandising.ts): collections, manual
   category order, abandoned bags. Routes: /site-api/manage/collections (WP-05), /manage/abandoned (WP-24). */
import type { Photo } from '../common'
import type { AdminProductRow } from './catalog'
import type { ListParams } from './common'

export interface AdminCollectionRow {
  id: string
  slug: string
  title: string
  image: Photo | null
  published: boolean
  featuredOnHome: boolean
  position: number
  productCount: number
  updatedAt: string
}

export interface AdminCollection extends AdminCollectionRow {
  description: string
  seoTitle: string | null
  seoDescription: string | null
  products: AdminProductRow[]
}

export interface AdminCollectionInput {
  title: string
  slug?: string
  description: string
  image: Photo | null
  published: boolean
  featuredOnHome: boolean
  seoTitle: string | null
  seoDescription: string | null
  productIds: string[]
}

/** GET /site-api/manage/collections/category-order?category= */
export interface CategoryOrder {
  category: { id: string; name: string; slug: string; dept: string; deptSlug: string }
  products: AdminProductRow[]
}

export type AbandonedStatus = 'active' | 'abandoned' | 'reminded' | 'superseded' | 'dismissed' | 'ordered'

export interface AbandonedBagRow {
  id: string
  email: string
  customerName: string | null
  userId: string | null
  value: number
  itemCount: number
  items: { name: string; meta: string; qty: number; total: number; image: Photo; productId: string }[]
  createdAt: string
  lastActivity: string
  reminderSentAt: string | null
  dismissedAt: string | null
  status: AbandonedStatus
}

/** GET /site-api/manage/abandoned: a keyset page plus the settings and the per-status summary VAREL showed */
export interface AbandonedList {
  items: AbandonedBagRow[]
  nextCursor: string | null
  settings: { enabled: boolean; hours: number }
  summary: Record<AbandonedStatus, { count: number; value: number }> & { recovered: { orders: number; revenue: number } }
}

export interface AbandonedParams extends ListParams {
  status?: 'all' | AbandonedStatus
  sort?: 'lastActivity' | '-lastActivity' | 'value' | '-value'
}

export type AbandonedBulkAction = 'remind' | 'dismiss' | 'restore'

export interface AbandonedBulkResult {
  action: AbandonedBulkAction
  done: number
  skipped: Partial<
    Record<'superseded' | 'dismissed' | 'duplicate' | 'missing' | 'error' | 'no-email' | 'empty' | 'ordered' | 'already-sent', number>
  >
}

/** POST /site-api/manage/abandoned/run, and the `abandoned-carts` job's result */
export interface AbandonedRunResult {
  enabled: boolean
  checked: number
  sent: number
}
