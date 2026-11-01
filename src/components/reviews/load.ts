/* Server-side read of the first page of a product's reviews, for the product page (WP-03) to await in
   parallel with the product itself: `const [product, reviews] = await Promise.all([…, loadReviews(api, slug)])`.
   Never throws: `null` when the read failed (the island then shows its "could not load" state with a retry). */
import type {backend} from '@/server/backend';
import {read} from '@/server/backend';
import {REVIEWS_PAGE_SIZE, type ReviewsResponse} from '@/lib/types/reviews';

type Api = ReturnType<typeof backend>;

export async function loadReviews(api: Api, slug: string): Promise<ReviewsResponse | null> {
  try {
    return await read<ReviewsResponse>(
      api.products[':slug'].reviews.$get({param: {slug}, query: {sort: 'newest', pageSize: String(REVIEWS_PAGE_SIZE)}}),
    );
  } catch {
    return null;
  }
}
