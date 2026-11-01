/* Filters + sort for a product listing island, stored in the URL so a view is shareable (replaces VAREL
   src/pages/catalog/useListingParams.ts, which used TanStack Router search + TanStack Query).

   The first answer comes from the server-rendered page (props), so first paint needs no fetch. Each change
   writes the URL (`history.pushState`, `replaceState` for the price slider, keeping the ClientRouter's
   `history.state`), then refetches `GET /site-api/products` through `siteFetch` (storefront-api `request`):
   the previous grid stays, dimmed, until the answer lands (VAREL keepPreviousData); a newer change aborts
   the older request. Back / forward re-read the URL (popstate). */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {notifyError} from '@/components/varel';
import {request} from '@/lib/storefront-api';
import type {Product} from '@/lib/types/catalog';

import {
  activeCount as countActive,
  type CatalogListing,
  clearFilters,
  type FacetKey,
  type ListingBase,
  listingHref,
  type ListingMode,
  type ListingScope,
  type ListingSearch,
  type ListingSort,
  parseListingSearch,
  type Selected,
  selectedOf,
  sortItems,
  sortOf,
  toApiQuery,
  toggleValue,
  withMaxPrice,
  withSort,
} from './listing';

export interface ListingState {
  sort: ListingSort;
  selected: Selected;
  maxPrice: number | undefined;
  /** Number of active facet values + price */
  activeCount: number;
  setSort: (sort: ListingSort) => void;
  toggle: (key: FacetKey, value: string) => void;
  setMaxPrice: (n: number | undefined) => void;
  clearAll: () => void;
}

export interface ListingData {
  /** Sorted items, or undefined while nothing has loaded */
  items: Product[] | undefined;
  total: number | undefined;
  /** The route-scope base listing (facets, counts, price ceiling) */
  base: ListingBase | null;
  isLoading: boolean;
  isError: boolean;
  /** A new answer is on its way; the previous items stay (dimmed) */
  isFetching: boolean;
  retry: () => void;
}

export interface UseListingOptions {
  mode: ListingMode;
  scope: ListingScope;
  initialSearch: ListingSearch;
  initialList: CatalogListing | null;
  initialBase: ListingBase | null;
  /** Shown as a toast when a refetch fails while results are still on screen */
  errorText: string;
}

export function useListingState({mode, scope, initialSearch, initialList, initialBase, errorText}: UseListingOptions): {
  params: ListingState;
  data: ListingData;
} {
  const [search, setSearch] = useState<ListingSearch>(initialSearch);
  const [list, setList] = useState<CatalogListing | null>(initialList);
  const [base, setBase] = useState<ListingBase | null>(initialBase);
  const [isFetching, setFetching] = useState(false);
  const [isError, setError] = useState(initialList === null);
  const seq = useRef(0);
  const aborter = useRef<AbortController | null>(null);
  const searchRef = useRef(search);
  const listRef = useRef(list);
  listRef.current = list;
  const baseRef = useRef(base);
  baseRef.current = base;

  const load = useCallback(
    (next: ListingSearch) => {
      const id = ++seq.current;
      aborter.current?.abort();
      const ctrl = new AbortController();
      aborter.current = ctrl;
      setFetching(true);
      // No base yet (the server read failed): ask for it with this read.
      const wantBase = baseRef.current ? undefined : mode === 'category' && scope.category ? 'category' : 'dept';
      request<CatalogListing>('/products', {query: toApiQuery(next, scope, wantBase), signal: ctrl.signal})
        .then(answer => {
          if (id !== seq.current) return;
          setList(answer);
          if (answer.base) setBase(answer.base);
          setError(false);
          setFetching(false);
        })
        .catch((error: unknown) => {
          if (id !== seq.current || (error as Error)?.name === 'AbortError') return;
          setFetching(false);
          setError(true);
          // Results still on screen: keep them (VAREL keeps previous data) and say so.
          if (listRef.current) notifyError(errorText);
        });
    },
    [mode, scope, errorText]
  );

  useEffect(() => () => aborter.current?.abort(), []);

  // Back / forward between filter states of this page.
  useEffect(() => {
    const path = location.pathname;
    const onPop = () => {
      if (location.pathname !== path) return; // another page: the ClientRouter swaps it
      const next = parseListingSearch(new URLSearchParams(location.search), mode);
      searchRef.current = next;
      setSearch(next);
      load(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [mode, load]);

  const update = useCallback(
    (fn: (prev: ListingSearch) => ListingSearch, replace = false) => {
      const next = fn(searchRef.current);
      searchRef.current = next;
      const url = listingHref(location.pathname, next) + location.hash;
      if (replace) history.replaceState(history.state, '', url);
      else history.pushState(history.state, '', url);
      setSearch(next);
      load(next);
    },
    [load]
  );

  const setSort = useCallback((s: ListingSort) => update(p => withSort(p, s)), [update]);
  const toggle = useCallback((key: FacetKey, value: string) => update(p => toggleValue(p, key, value)), [update]);
  const setMaxPrice = useCallback((v: number | undefined) => update(p => withMaxPrice(p, v), true), [update]);
  const clearAll = useCallback(() => update(clearFilters), [update]);
  const retry = useCallback(() => load(search), [load, search]);

  const sort = sortOf(search);
  const selected = useMemo(() => selectedOf(search), [search]);
  const items = useMemo(() => (list ? sortItems(list.items, sort) : undefined), [list, sort]);

  return {
    params: {
      sort,
      selected,
      maxPrice: search.maxPrice,
      activeCount: countActive(search),
      setSort,
      toggle,
      setMaxPrice,
      clearAll,
    },
    data: {
      items,
      total: list?.total,
      base,
      isLoading: !list && isFetching,
      isError,
      isFetching: !!list && isFetching,
      retry,
    },
  };
}
