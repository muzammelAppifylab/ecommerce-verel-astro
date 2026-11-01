/* Catalog listing helpers shared by the shop pages (server), the listing island (browser) and tests.
   Port of the pure parts of VAREL src/pages/catalog/useListingParams.ts. URL format unchanged, so shared
   VAREL links keep working: ?sort=price-asc&category=Shirts,Dresses&color=Stone&size=M&material=…&brand=…&maxPrice=200
   (`sort=featured` is never written; unknown or malformed values are dropped, never a 422 on a page). */
import {type ListingSearch, type ListingSort, rawSearch, validateListingSearch} from '@/lib/search-params';
import type {Facet, ListingBase, Product, ProductListResponse, ProductQuery} from '@/lib/types/catalog';

export type {ListingSearch, ListingSort, ListingBase};

/** A `GET /site-api/products` answer (with `base` when asked). */
export type CatalogListing = ProductListResponse;

export type FacetKey = Facet['key'];
export const FACET_KEYS: FacetKey[] = ['category', 'color', 'size', 'material', 'brand'];

/** Sort options in display order; labels are `catalog:sort.<value>`. */
export const SORT_OPTIONS: ListingSort[] = ['featured', 'newest', 'price-asc', 'price-desc', 'name'];

/** Category pages: no "Newest" (VAREL Category.tsx). */
export const CATEGORY_SORTS: ListingSort[] = ['featured', 'price-asc', 'price-desc', 'name'];

export type ListingMode = 'shop' | 'category';

export type Selected = Record<FacetKey, string[]>;

/** The URL keys of a listing view, in the order they are written. */
const URL_KEYS = ['sort', ...FACET_KEYS, 'maxPrice'] as const;

/** Parse a listing URL's search params. Category pages ignore `?category=` (the route category wins,
    VAREL spread route params last), so it is stripped there and never counted as an active filter. */
export function parseListingSearch(params: URLSearchParams, mode: ListingMode = 'shop'): ListingSearch {
  const search = validateListingSearch(rawSearch(params));
  if (mode === 'category') delete search.category;
  return search;
}

/** The selected values per facet key ([] when none). */
export function selectedOf(search: ListingSearch): Selected {
  const out = {} as Selected;
  for (const k of FACET_KEYS) out[k] = search[k] ?? [];
  return out;
}

/** The sort in effect (`featured` when absent). */
export const sortOf = (search: ListingSearch): ListingSort => search.sort ?? 'featured';

/** Active facet values + price (VAREL `activeCount`). */
export function activeCount(search: ListingSearch): number {
  return FACET_KEYS.reduce((n, k) => n + (search[k]?.length ?? 0), 0) + (search.maxPrice !== undefined ? 1 : 0);
}

/** Add or remove one facet value; an emptied key is removed. */
export function toggleValue(search: ListingSearch, key: FacetKey, value: string): ListingSearch {
  const cur = search[key] ?? [];
  const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
  const out: ListingSearch = {...search};
  if (next.length) out[key] = next;
  else delete out[key];
  return out;
}

export function withSort(search: ListingSearch, sort: ListingSort): ListingSearch {
  const out: ListingSearch = {...search};
  if (sort === 'featured') delete out.sort;
  else out.sort = sort;
  return out;
}

export function withMaxPrice(search: ListingSearch, maxPrice: number | undefined): ListingSearch {
  const out: ListingSearch = {...search};
  if (maxPrice === undefined) delete out.maxPrice;
  else out.maxPrice = maxPrice;
  return out;
}

/** Remove every facet value and the price; keep the sort (VAREL `clearAll`). */
export function clearFilters(search: ListingSearch): ListingSearch {
  return search.sort ? {sort: search.sort} : {};
}

/** `?sort=…&category=…&…&maxPrice=…` (comma-joined lists, fixed key order, empty keys omitted). */
export function listingQueryString(search: ListingSearch): string {
  const parts: string[] = [];
  for (const k of URL_KEYS) {
    const v = search[k];
    if (v === undefined || v === null) continue;
    const s = Array.isArray(v) ? v.join(',') : String(v);
    if (s === '') continue;
    // Commas stay readable (as VAREL's URLs); everything else is encoded.
    parts.push(`${k}=${encodeURIComponent(s).replace(/%2C/gi, ',')}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** A listing URL: the page path (with its language prefix) + the search. */
export function listingHref(pathname: string, search: ListingSearch): string {
  return pathname + listingQueryString(search);
}

/** Route scope of a page: '' on Shop, the slugs on department / category pages. */
export interface ListingScope {
  dept?: string;
  category?: string;
}

/** The `GET /site-api/products` query for a view: `name` is sorted on the client (API gets `featured`);
    the route scope overrides any category in the URL. Arrays are comma-joined by the clients. */
export function toApiQuery(search: ListingSearch, scope: ListingScope = {}, base?: ProductQuery['base']) {
  const sort = sortOf(search);
  const category = scope.category ? [scope.category] : (search.category ?? []);
  const query: Record<string, string> = {sort: sort === 'name' ? 'featured' : sort};
  if (scope.dept) query.dept = scope.dept;
  if (category.length) query.category = category.join(',');
  for (const k of ['color', 'size', 'material', 'brand'] as const) {
    const v = search[k];
    if (v?.length) query[k] = v.join(',');
  }
  if (search.maxPrice !== undefined) query.maxPrice = String(search.maxPrice);
  if (base) query.base = base;
  return query;
}

/** Apply the client-only name sort (never mutates). */
export function sortItems(items: Product[], sort: ListingSort): Product[] {
  return sort === 'name' ? [...items].sort((a, b) => a.name.localeCompare(b.name)) : items;
}

/** Slider ceiling: the base set's priceMax rounded up to the 5-unit step. */
export function priceCeiling(priceMax: number | undefined): number {
  return Math.max(5, Math.ceil((priceMax ?? 0) / 5) * 5);
}
