import type {QueryClient} from '@tanstack/react-query';

import type {RawSearch} from './search-params';

/** Review moderation (`/dashboard/reviews`). WP-04 owns this file (`/site-api/manage/reviews`). */

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'all'] as const;

export interface ReviewsSearch {
  status?: (typeof REVIEW_STATUSES)[number];
  rating?: number;
  q?: string;
  page?: number;
}

export function validateReviewsSearch(raw: RawSearch): ReviewsSearch {
  const s =
    typeof raw.status === 'string' && (REVIEW_STATUSES as readonly string[]).includes(raw.status) ? (raw.status as ReviewsSearch['status']) : undefined;
  const rating = Number(raw.rating);
  const page = Number(raw.page);
  const q = typeof raw.q === 'string' && raw.q.trim() ? raw.q.trim() : undefined;
  return {
    ...(s ? {status: s} : {}),
    ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? {rating} : {}),
    ...(q ? {q} : {}),
    ...(Number.isInteger(page) && page > 1 ? {page} : {}),
  };
}

/** WP-04 implements. */
export const loadReviews = (_queryClient: QueryClient, _search: ReviewsSearch): Promise<void> => Promise.resolve();
