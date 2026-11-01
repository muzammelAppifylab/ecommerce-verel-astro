/*
 * The bag on the storefront: one client cache + every bag mutation (WP-09). Replaces VAREL's TanStack Query hooks
 * (src/lib/api/hooks.ts: useCart, useAddToCart, useUpdateLine, useRemoveLine, useApplyDiscount, useRemoveDiscount,
 * useCartTotals) without a library: a module-level store read with `useSyncExternalStore`.
 *
 * - Fresh for 10 s (VAREL `staleTime: 10_000`); refetched when the tab comes back (focus / visible) and is stale.
 * - Every write answers the whole Cart, which replaces the cache in one step.
 * - Quantity changes and removals are optimistic and roll back with an error toast (VAREL onMutate/onError).
 * - Discount apply/remove are never optimistic; their errors are thrown for the form to show inline.
 * - Every cart the server returns is reported to F2's bag store (`bag.applyCart`): the header count follows and a
 *   `varel:cart` event fires (CART_EVENT). Carts other islands report there (F2 `bag.addToBag`, WP-10
 *   move-to-bag) land in this cache too.
 *
 * Cross-package contract (WP-03 product, WP-02/WP-01 tiles, WP-10 wishlist, WP-12 checkout): keep the exports.
 */
import {useSyncExternalStore} from 'react';

import {notifyError} from '@/components/varel/Toast';
import {bag, CART_EVENT as BAG_CART_EVENT} from '@/lib/stores/bag';
import {api, ApiError, errorMessage} from '@/lib/storefront-api';
import type {AddToCartInput, Cart, CartEmailInput, DiscountContext, Totals} from '@/lib/types/cart';

export type CartStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CartState {
  cart: Cart | null;
  status: CartStatus;
  error: ApiError | null;
  /** When the cached cart came from the server (ms epoch; 0 = never) */
  loadedAt: number;
}

/** window CustomEvent<Cart> fired after every bag change (WP-12 re-reads its totals on it). */
export const CART_EVENT = BAG_CART_EVENT;

/** How long a read bag counts as fresh (VAREL staleTime). */
export const CART_STALE_MS = 10_000;

const INITIAL: CartState = {cart: null, status: 'idle', error: null, loadedAt: 0};

let state: CartState = INITIAL;
/** Bumped by every cache write, so a slower read never overwrites a newer write. */
let version = 0;
let inflight: Promise<Cart | null> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

function patch(next: Partial<CartState>) {
  state = {...state, ...next};
  emit();
}

/** Cache a server cart; `report` also tells F2's bag store (count + CART_EVENT). */
function store(cart: Cart, report: boolean) {
  version++;
  state = {cart, status: 'ready', error: null, loadedAt: Date.now()};
  emit();
  if (report) bag.applyCart(cart);
}

const isStale = () => !state.cart || Date.now() - state.loadedAt > CART_STALE_MS;

let wired = false;
/** Browser only, once: follow carts reported by other islands, refetch on return when stale. */
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener(CART_EVENT, e => {
    const cart = (e as CustomEvent<Cart>).detail;
    // Our own reports come back here as the same object; anything else is newer news from another island.
    if (cart && cart !== state.cart && Array.isArray(cart.lines) && cart.totals) store(cart, false);
  });
  const onReturn = () => {
    if (document.visibilityState === 'visible' && listeners.size > 0 && state.cart && isStale()) void cartStore.load();
  };
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);
}

export const cartStore = {
  get: (): CartState => state,

  subscribe(fn: () => void): () => void {
    wire();
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** GET /cart. Skipped while the cache is fresh (< 10 s) unless `force`; one request at a time. */
  load(opts: {force?: boolean} = {}): Promise<Cart | null> {
    if (typeof window === 'undefined') return Promise.resolve(state.cart);
    wire();
    if (!opts.force && !isStale()) return Promise.resolve(state.cart);
    if (inflight) return inflight;
    const started = version;
    patch({status: 'loading'});
    inflight = api
      .get<Cart>('/cart')
      .then(cart => {
        if (version === started) store(cart, true);
        else patch({status: 'ready'});
        return state.cart;
      })
      .catch((e: unknown) => {
        const error = e instanceof ApiError ? e : new ApiError(0, 'NETWORK', errorMessage(e));
        patch({status: state.cart ? 'ready' : 'error', error});
        return state.cart;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  /** Replace the cache with a cart the server returned (any bag write), and report it. */
  set(cart: Cart): void {
    store(cart, true);
  },

  /** The bag a page rendered on the server (cart page): cached as fresh, no fetch. Keeps a newer cache. */
  hydrate(cart: Cart | null): void {
    if (!cart || typeof window === 'undefined') return;
    if (state.cart && state.loadedAt > 0 && !isStale()) return;
    store(cart, true);
  },
};

/** `const {cart, status, error, refetch} = useCart()` (VAREL useCart). */
export function useCart(): CartState & {refetch: () => Promise<Cart | null>} {
  const s = useSyncExternalStore(cartStore.subscribe, cartStore.get, () => INITIAL);
  return {...s, refetch: () => cartStore.load({force: true})};
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

/** POST /cart/items. Throws ApiError (404 product, 422 variant, 409 stock / bag full). See actions.ts addToBag. */
export async function postItem(input: AddToCartInput): Promise<Cart> {
  const cart = await api.post<Cart>('/cart/items', input);
  cartStore.set(cart);
  return cart;
}

/** Optimistic write: show `next` now, roll back and toast on failure (VAREL onMutate / onError). */
async function optimistic(next: (cart: Cart) => Cart, send: () => Promise<Cart>): Promise<Cart> {
  const prev = state.cart;
  if (prev) {
    version++;
    state = {...state, cart: next(prev)};
    emit();
  }
  try {
    const cart = await send();
    cartStore.set(cart);
    return cart;
  } catch (e) {
    if (prev) {
      version++;
      state = {...state, cart: prev};
      emit();
    }
    notifyError(errorMessage(e));
    throw e;
  }
}

/** Change a line's quantity (0 removes). Optimistic; rolls back with an error toast. */
export function updateLine(lineId: string, qty: number): Promise<Cart> {
  return optimistic(
    cart => ({
      ...cart,
      lines: cart.lines.map(l => (l.lineId === lineId ? {...l, qty, total: Math.round(l.unit * qty * 100) / 100} : l)).filter(l => l.qty > 0),
    }),
    () => api.patch<Cart>(`/cart/items/${encodeURIComponent(lineId)}`, {qty})
  );
}

/** Remove a line. Optimistic; rolls back with an error toast. */
export function removeLine(lineId: string): Promise<Cart> {
  return optimistic(
    cart => ({...cart, lines: cart.lines.filter(l => l.lineId !== lineId)}),
    () => api.del<Cart>(`/cart/items/${encodeURIComponent(lineId)}`)
  );
}

/** Apply a discount code. Errors (discount_invalid, …) are NOT toasted: they are thrown for the form to show inline. */
export async function applyDiscount(code: string, context?: DiscountContext): Promise<Cart> {
  const cart = await api.post<Cart>('/cart/discount', {code: code.trim(), ...(context ?? {})});
  cartStore.set(cart);
  return cart;
}

/** Remove the stored code. Throws ApiError. */
export async function removeDiscount(): Promise<Cart> {
  const cart = await api.del<Cart>('/cart/discount');
  cartStore.set(cart);
  return cart;
}

/** Totals for checkout with a chosen country + shipping method id, and the checkout email once it's known
 *  (offers limited to first orders or per customer are then checked for it, as checkout will). WP-12. */
export function fetchTotals(
  q: {country?: string; method?: string | null; email?: string},
  signal?: AbortSignal
): Promise<Totals> {
  return api.get<Totals>('/cart/totals', {country: q.country, method: q.method ?? undefined, email: q.email}, signal);
}

/** Abandoned-bag email capture. Best effort: any error is ignored (VAREL checkout/payments.ts). WP-12. */
export function captureCartEmail(email: string): void {
  api.post<CartEmailInput>('/cart/email', {email} satisfies CartEmailInput).catch(() => undefined);
}
