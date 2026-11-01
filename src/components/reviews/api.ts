/* Reviews island → Site API (VAREL src/lib/api/reviews.ts hooks as plain calls: no query library on
   public pages). GET/POST /site-api/products/:slug/reviews, GET …/eligibility (src/server/routes/reviews.ts). */
import {request} from '@/lib/storefront-api';
import {
  REVIEWS_PAGE_SIZE,
  type ReviewEligibility,
  type ReviewInput,
  type ReviewSort,
  type ReviewSubmitResponse,
  type ReviewsResponse,
} from '@/lib/types/reviews';

const base = (slug: string) => `/products/${encodeURIComponent(slug)}/reviews`;

/** One page of approved reviews. `fresh` skips the 60 s public cache (after the visitor's own review went live). */
export function fetchReviews(
  slug: string,
  opts: {sort: ReviewSort; cursor: string | null; page: number; fresh?: boolean},
  signal?: AbortSignal,
): Promise<ReviewsResponse> {
  return request<ReviewsResponse>(base(slug), {
    query: {
      sort: opts.sort,
      pageSize: REVIEWS_PAGE_SIZE,
      page: opts.page,
      cursor: opts.cursor ?? undefined,
      fresh: opts.fresh ? Date.now() : undefined,
    },
    signal,
  });
}

/** Can the signed-in visitor review the piece (private, per visitor). */
export function fetchEligibility(slug: string, signal?: AbortSignal): Promise<ReviewEligibility> {
  return request<ReviewEligibility>(`${base(slug)}/eligibility`, {signal});
}

export function submitReview(slug: string, input: ReviewInput): Promise<ReviewSubmitResponse> {
  return request<ReviewSubmitResponse>(base(slug), {method: 'POST', body: input});
}
