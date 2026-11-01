/*
 * Storefront UI state shared by islands (ported from VAREL `src/lib/ui-store.tsx`): the mobile menu and the
 * search overlay. The bag drawer's open state lives in the bag store (./bag), and `ui` re-exposes it so VAREL's
 * `ui.openBag()` / `useUI().openBag` calls port unchanged. No provider; works outside React too.
 */
import {useSyncExternalStore} from 'react';

import {bag, useBag} from './bag';

export interface UIState {
  menuOpen: boolean;
  searchOpen: boolean;
}

const INITIAL: UIState = {menuOpen: false, searchOpen: false};
let state: UIState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<UIState>) {
  state = {...state, ...patch};
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Imperative API, usable outside React (e.g. after an add-to-bag request). */
export const ui = {
  get: () => state,
  openBag: () => {
    set({menuOpen: false, searchOpen: false});
    bag.openBag();
  },
  closeBag: () => bag.closeBag(),
  setBagOpen: (open: boolean) => bag.setOpen(open),
  openMenu: () => set({menuOpen: true}),
  closeMenu: () => set({menuOpen: false}),
  setMenuOpen: (menuOpen: boolean) => set({menuOpen}),
  openSearch: () => set({searchOpen: true, menuOpen: false}),
  closeSearch: () => set({searchOpen: false}),
  setSearchOpen: (searchOpen: boolean) => set({searchOpen}),
  /** Close every layer (the layouts call it on each client navigation). */
  closeAll: () => {
    set({menuOpen: false, searchOpen: false});
    bag.closeBag();
  },
};

/** const { bagOpen, menuOpen, openBag, closeMenu, … } = useUI() */
export function useUI() {
  const s = useSyncExternalStore(subscribe, () => state, () => INITIAL);
  const {open: bagOpen} = useBag();
  return {...s, bagOpen, ...ui};
}
