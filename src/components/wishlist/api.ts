/* Wishlist calls from the browser (VAREL src/lib/api/endpoints.ts + hooks.ts, wishlist part), over siteFetch
   (src/lib/storefront-api.ts). The add / remove toggle lives in the shared bag store (src/lib/stores/bag.ts:
   `bag.toggleWishlist`, optimistic with rollback); this file adds the page's list read and "Add all in stock".
   The response types are the route's contract (src/server/routes/wishlist.ts imports them, type-only). */
import {request} from '@/lib/storefront-api';
import type {Cart} from '@/lib/types/cart';
import type {Product} from '@/lib/types/catalog';

/** GET /site-api/wishlist: the saved pieces (published only, oldest first) and their ids. */
export interface WishlistResponse {
  items: Product[];
  ids: string[];
}

/** POST /site-api/wishlist/move-to-bag: the bag after the move and the pieces still saved. */
export interface WishlistMoveResponse {
  cart: Cart;
  ids: string[];
}

export const getWishlist = () => request<WishlistResponse>('/wishlist');

/** Move pieces to the bag (all of them when `productIds` is omitted). */
export const moveToBag = (productIds?: string[]) =>
  request<WishlistMoveResponse>('/wishlist/move-to-bag', {method: 'POST', body: productIds ? {productIds} : {}});
