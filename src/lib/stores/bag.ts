/*
 * Bag and wishlist state shared by every storefront island (header counts, bag drawer, product tiles,
 * product page, wishlist page). No library: a module-level store with subscribe/set, mirrored to
 *   - a `varel:bag` CustomEvent on window (detail: BagState) for plain scripts and other islands, and
 *   - sessionStorage (`varel:bag`), so the counts show at once after a reload or a full page load.
 * Islands on one page share this module instance; ClientRouter navigations keep it.
 *
 * The cart itself (lines, totals, discounts) belongs to WP-09 (`/site-api/cart`, src/components/cart).
 * Anything that changes the cart reports the new cart with `bag.applyCart(cart)`: the count follows and a
 * `varel:cart` event (detail: the cart) tells the bag drawer content to re-render without refetching.
 */
import {useSyncExternalStore} from 'react';

import {siteFetch} from '@/platform/browser';

export interface BagState {
  /** Pieces in the bag (Cart.totals.count) */
  count: number;
  /** Wished product ids (slugs) */
  wishlist: string[];
  /** The bag drawer is open */
  open: boolean;
  /** The counts came from the server this visit (not only from sessionStorage) */
  synced: boolean;
}

/** The part of the cart the shell reads (WP-09's `Cart` satisfies it). */
export interface CartLike {
  totals?: {count?: number} | null;
}

export interface AddToBagInput {
  productId: string;
  color?: string | null;
  size?: string | null;
  qty?: number;
  /** Custom options (beyond colour and size), e.g. { Fabric: 'Canvas' } */
  options?: Record<string, string>;
}

/** An answer from the Site API that was not OK: `message` is safe to show. */
export class BagApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
  }
}

export const BAG_EVENT = 'varel:bag';
export const CART_EVENT = 'varel:cart';
const STORAGE_KEY = 'varel:bag';

const INITIAL: BagState = {count: 0, wishlist: [], open: false, synced: false};
let state: BagState = INITIAL;
const listeners = new Set<() => void>();
let restored = false;

function restore() {
  if (restored || typeof window === 'undefined') return;
  restored = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<BagState>;
    state = {
      ...state,
      count: typeof saved.count === 'number' && saved.count >= 0 ? saved.count : 0,
      wishlist: Array.isArray(saved.wishlist) ? saved.wishlist.filter(id => typeof id === 'string') : [],
    };
  } catch {
    // Storage blocked or corrupt: start empty, the server answer fills it in.
  }
}

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({count: state.count, wishlist: state.wishlist}));
  } catch {
    // Storage blocked: the counts still live for this page.
  }
}

function set(patch: Partial<BagState>) {
  restore();
  state = {...state, ...patch};
  if (typeof window === 'undefined') return;
  persist();
  listeners.forEach(l => l());
  window.dispatchEvent(new CustomEvent<BagState>(BAG_EVENT, {detail: state}));
}

function subscribe(listener: () => void) {
  restore();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The page language, sent so server text (stock labels, errors) comes back translated. */
const locale = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'en';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-locale', locale());
  if (init.body) headers.set('content-type', 'application/json');
  const res = await siteFetch(`/site-api${path}`, {...init, headers});
  const body = (await res.json().catch(() => null)) as
    | (T & {error?: string; message?: string; fields?: Record<string, string>})
    | null;
  if (!res.ok) {
    throw new BagApiError(
      res.status,
      body?.error ?? 'error',
      body?.message ?? 'Something went wrong. Please try again.',
      body?.fields
    );
  }
  return body as T;
}

let syncing: Promise<void> | null = null;

/** Imperative API, usable outside React (event handlers, plain scripts). */
export const bag = {
  get: (): BagState => {
    restore();
    return state;
  },
  subscribe,
  set,
  openBag: () => set({open: true}),
  closeBag: () => set({open: false}),
  setOpen: (open: boolean) => set({open}),
  setCount: (count: number) => set({count: Math.max(0, Math.floor(count))}),
  setWishlist: (ids: string[]) => set({wishlist: [...new Set(ids)]}),

  /** Report a cart the server returned (any cart mutation): updates the count and tells the drawer content. */
  applyCart<C extends CartLike>(cart: C): C {
    set({count: cart.totals?.count ?? 0, synced: true});
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<C>(CART_EVENT, {detail: cart}));
    return cart;
  },

  /** Read the bag count and the wishlist from the server once per visit (never throws). */
  sync(force = false): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve();
    if (syncing && !force) return syncing;
    syncing = (async () => {
      const [cart, wished] = await Promise.allSettled([
        request<CartLike>('/cart'),
        request<Array<{id: string}> | {ids: string[]}>('/wishlist'),
      ]);
      const patch: Partial<BagState> = {synced: true};
      if (cart.status === 'fulfilled' && cart.value) patch.count = cart.value.totals?.count ?? 0;
      if (wished.status === 'fulfilled' && wished.value) {
        const v = wished.value;
        patch.wishlist = Array.isArray(v) ? v.map(p => p.id) : Array.isArray(v.ids) ? v.ids : state.wishlist;
      }
      set(patch);
    })();
    return syncing;
  },

  /** POST /cart/items (VAREL docs/API.md): adds a line, reports the cart and opens the drawer. */
  async addToBag(input: AddToBagInput, {open = true}: {open?: boolean} = {}): Promise<CartLike> {
    const cart = await request<CartLike>('/cart/items', {
      method: 'POST',
      body: JSON.stringify({qty: 1, ...input}),
    });
    bag.applyCart(cart);
    if (open) bag.openBag();
    return cart;
  },

  /** Add or remove a product from the wishlist, optimistically; rolls back when the server refuses. */
  async toggleWishlist(productId: string, on: boolean): Promise<void> {
    const before = state.wishlist;
    set({wishlist: on ? [...new Set([...before, productId])] : before.filter(id => id !== productId)});
    try {
      const res = on
        ? await request<{ids: string[]}>('/wishlist', {method: 'POST', body: JSON.stringify({productId})})
        : await request<{ids: string[]}>(`/wishlist/${encodeURIComponent(productId)}`, {method: 'DELETE'});
      if (Array.isArray(res?.ids)) set({wishlist: res.ids});
    } catch (error) {
      set({wishlist: before});
      throw error;
    }
  },
};

/** `const {count, wishlist, open} = useBag()`: re-renders on every change. */
export function useBag(): BagState {
  return useSyncExternalStore(subscribe, bag.get, () => INITIAL);
}

/** `const wished = useWished(product.id)` */
export function useWished(productId: string): boolean {
  return useBag().wishlist.includes(productId);
}
