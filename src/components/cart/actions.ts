/*
 * Add to bag from any storefront island (WP-09 contract): product page buy column (WP-03), product tiles
 * (WP-02 / WP-01 home), wishlist (WP-10), anything else that puts a piece in the bag.
 *
 *   await addToBag({productId, variantId, color, size, qty})            // opens the bag drawer
 *   await addToBag({productId, qty: 1}, {openBag: false})               // stay put (wishlist)
 *
 * Port of VAREL `useAddToCart` (src/lib/api/hooks.ts): on success the bag cache is replaced (header count and
 * drawer follow), an `add_to_cart` analytics signal is sent (`varel:add-to-bag` window event, for WP-16's
 * consent-gated tracker) and the drawer opens unless `openBag === false`; on failure an error toast shows unless
 * `toastOnError === false`. Always rethrows, so callers can show "Added to bag" only on success.
 */
import {notifyError} from '@/components/varel/Toast';
import {ui} from '@/lib/stores/ui';
import {errorMessage} from '@/lib/storefront-api';
import type {AddToCartInput, Cart} from '@/lib/types/cart';

import {postItem} from './cart-store';

export {
  applyDiscount,
  captureCartEmail,
  CART_EVENT,
  cartStore,
  fetchTotals,
  removeDiscount,
  removeLine,
  updateLine,
  useCart,
} from './cart-store';

/** window CustomEvent<{productId, variantId, qty}> after a successful add (analytics hook, WP-16). */
export const ADD_TO_BAG_EVENT = 'varel:add-to-bag';

export interface AddToBagOptions {
  /** Open the bag drawer after adding (default true) */
  openBag?: boolean;
  /** Show the server's message in an error toast (default true) */
  toastOnError?: boolean;
}

export async function addToBag(input: AddToCartInput, opts: AddToBagOptions = {}): Promise<Cart> {
  try {
    const cart = await postItem({...input, qty: input.qty ?? 1});
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(ADD_TO_BAG_EVENT, {detail: {productId: input.productId, variantId: input.variantId ?? null, qty: input.qty ?? 1}})
      );
    }
    if (opts.openBag !== false) ui.openBag();
    return cart;
  } catch (e) {
    if (opts.toastOnError !== false) notifyError(errorMessage(e));
    throw e;
  }
}
