import {infiniteQueryOptions, queryOptions, type QueryClient} from '@tanstack/react-query';

import type {AdminReview, AdminReviewBulk, AdminReviewList, AdminReviewUpdate} from '../../lib/types/admin/reviews';
import type {StoreSettings} from '../../lib/types/admin/store';
import {manage} from '../api';
import type {RawSearch} from './search-params';

/**
 * Review moderation (`/dashboard/reviews`). WP-04 owns this file (`/site-api/manage/reviews`).
 * Port of VAREL `src/lib/admin/reviews.ts` (reviews half): page numbers became keyset pages
 * (`useInfiniteQuery` + "Load more"), so the search has no `page`.
 */

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'all'] as const;
export type ReviewView = (typeof REVIEW_STATUSES)[number];

export interface ReviewsSearch {
  status?: ReviewView;
  rating?: number;
  q?: string;
}

export const REVIEWS_PAGE_SIZE = 20;

export function validateReviewsSearch(raw: RawSearch): ReviewsSearch {
  const s =
    typeof raw.status === 'string' && (REVIEW_STATUSES as readonly string[]).includes(raw.status) ? (raw.status as ReviewView) : undefined;
  const rating = Number(raw.rating);
  const q = typeof raw.q === 'string' && raw.q.trim() ? raw.q.trim().slice(0, 200) : undefined;
  return {
    ...(s ? {status: s} : {}),
    ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? {rating} : {}),
    ...(q ? {q} : {}),
  };
}

export const reviewKeys = {all: ['manage', 'reviews'] as const};

/** One keyset-paged list per search; the tab counts come with every page (read them from the first). */
export const reviewsQuery = (search: ReviewsSearch) =>
  infiniteQueryOptions({
    queryKey: [...reviewKeys.all, search],
    queryFn: ({pageParam, signal}) =>
      manage<AdminReviewList>('reviews', {
        query: {status: search.status ?? 'pending', rating: search.rating, q: search.q, cursor: pageParam, pageSize: REVIEWS_PAGE_SIZE},
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
  });

export const loadReviews = (queryClient: QueryClient, search: ReviewsSearch): Promise<void> =>
  queryClient.ensureInfiniteQueryData(reviewsQuery(search)).then(() => undefined);

/**
 * The store settings (the two review toggles live there). WP-23 owns the settings screen and
 * `GET/PATCH /site-api/manage/settings`; the key is shared so both screens stay in step.
 */
export const reviewSettingsQuery = queryOptions({
  queryKey: ['manage', 'settings'] as const,
  queryFn: ({signal}) => manage<StoreSettings>('settings', {signal}),
  staleTime: 30_000,
});

export const updateReview = ({id, ...body}: AdminReviewUpdate & {id: string}) =>
  manage<AdminReview>(`reviews/${encodeURIComponent(id)}`, {method: 'PATCH', body});

export const deleteReview = (id: string) => manage<null>(`reviews/${encodeURIComponent(id)}`, {method: 'DELETE'});

export const bulkReviews = (body: AdminReviewBulk) => manage<{updated: number}>('reviews/bulk', {method: 'POST', body});

export const updateReviewSettings = (patch: Partial<Pick<StoreSettings, 'reviewsEnabled' | 'reviewsRequireApproval'>>) =>
  manage<StoreSettings>('settings', {method: 'PATCH', body: patch});

/** After a moderation change: the queue, and the product lists that show ratings. */
export function invalidateReviews(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({queryKey: reviewKeys.all}),
    queryClient.invalidateQueries({queryKey: ['manage', 'products']}),
  ]);
}
