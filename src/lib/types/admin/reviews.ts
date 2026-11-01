/* Admin review moderation (VAREL src/lib/admin/reviews.ts). Routes: /site-api/manage/reviews (WP-04). */
import type { ListParams } from './common'

export type AdminReviewStatus = 'pending' | 'approved' | 'rejected'

export interface AdminReview {
  id: string
  productId: string
  productName: string
  productImage: { src: string; credit: string; creditHref: string } | null
  name: string
  email: string
  rating: number
  title: string
  body: string
  status: AdminReviewStatus
  verifiedPurchase: boolean
  reply: string | null
  createdAt: string
  updatedAt: string
}

/** A keyset page plus the per-status counts of the tabs (one grouped query) */
export interface AdminReviewList {
  items: AdminReview[]
  nextCursor: string | null
  counts: Record<AdminReviewStatus | 'all', number>
}

export interface ReviewsSearch extends ListParams {
  status?: AdminReviewStatus | 'all'
  rating?: number
}

/** PATCH /site-api/manage/reviews/:id */
export interface AdminReviewUpdate {
  status?: AdminReviewStatus
  reply?: string | null
}

/** POST /site-api/manage/reviews/bulk */
export interface AdminReviewBulk {
  ids: string[]
  action: 'approve' | 'reject' | 'delete'
}
