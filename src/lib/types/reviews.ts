/* Product reviews on the storefront (VAREL src/lib/api/reviews.ts).
   GET/POST /site-api/products/:slug/reviews, GET …/eligibility (reviews.ts, WP-04). */

export type ReviewSort = 'newest' | 'highest' | 'lowest'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface PublicReview {
  id: string
  name: string
  rating: number
  title: string
  body: string
  verifiedPurchase: boolean
  reply: string | null
  createdAt: string
}

export interface ReviewSummary {
  avg: number
  count: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
}

/** VAREL pages reviews by number (5 a page, small per product); kept for parity. */
export interface ReviewsResponse {
  summary: ReviewSummary
  items: PublicReview[]
  total: number
  page: number
  pageSize: number
  /** Keyset cursor for the next page (`?cursor=`); null at the end. `page` stays for VAREL callers. */
  nextCursor: string | null
  settings: { enabled: boolean; requireApproval: boolean; verifiedOnly: boolean }
}

export interface ReviewInput {
  rating: number
  title: string
  body: string
}

/** Whether the signed-in visitor may review the piece: only customers with a paid order for it, once. */
export interface ReviewEligibility {
  canReview: boolean
  reason: 'ok' | 'closed' | 'signin' | 'purchase' | 'reviewed'
  /** "Mira H.": how the signed-in viewer's review will be signed; null for a guest */
  postingAs?: string | null
}

export interface ReviewSubmitResponse {
  status: ReviewStatus
  verifiedPurchase: boolean
  review: PublicReview | null
}

export const REVIEWS_PAGE_SIZE = 5

/** "4.7" — one decimal, trailing zero kept so the line reads evenly. */
export const ratingText = (avg: number) => avg.toFixed(1)
