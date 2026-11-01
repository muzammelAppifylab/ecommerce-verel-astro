/* Typed URL search params for TanStack Router.

   The router is configured (src/router.tsx) with a plain URLSearchParams parser/serialiser, so the
   query string looks exactly like it did before the port: every raw value arrives here as a string,
   arrays are written comma-separated (?color=Stone,Black) and numbers as digits (?maxPrice=200).
   Each `validate*` function below is a route's `validateSearch`: it turns the raw strings into a
   typed object, dropping anything malformed. Every key is optional so links never have to pass one. */

type Raw = Record<string, unknown>

/** Non-empty trimmed string, or undefined. */
export function str(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s : undefined
}

/** Comma-separated list ("a,b") or an array, as a non-empty string[] (or undefined). */
export function list(v: unknown): string[] | undefined {
  const parts = Array.isArray(v) ? v.map(String) : (str(v)?.split(',') ?? [])
  const out = parts.map((s) => s.trim()).filter(Boolean)
  return out.length ? out : undefined
}

/** One of `allowed`, or undefined. */
export function oneOf<const T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const s = str(v)
  return s !== undefined && (allowed as readonly string[]).includes(s) ? (s as T) : undefined
}

/** Finite number ≥ 0, or undefined. */
export function nonNegative(v: unknown): number | undefined {
  const s = str(v)
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Drop undefined keys so links/navigation never serialise `?key=` noise. */
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

/* ── Catalog: /shop, /shop/$dept, /shop/$dept/$category ─────────────────── */
export const LISTING_SORTS = ['featured', 'newest', 'price-asc', 'price-desc', 'name'] as const
export type ListingSort = (typeof LISTING_SORTS)[number]

export interface ListingSearch {
  sort?: Exclude<ListingSort, 'featured'>
  category?: string[]
  color?: string[]
  size?: string[]
  material?: string[]
  brand?: string[]
  maxPrice?: number
}

export function validateListingSearch(raw: Raw): ListingSearch {
  const sort = oneOf(raw.sort, LISTING_SORTS)
  return clean({
    sort: sort === 'featured' ? undefined : sort,
    category: list(raw.category),
    color: list(raw.color),
    size: list(raw.size),
    material: list(raw.material),
    brand: list(raw.brand),
    maxPrice: nonNegative(raw.maxPrice),
  })
}

/* ── /search?q=&tab= ─────────────────────────────────────────────────────── */
export const SEARCH_TABS = ['all', 'products', 'categories', 'journal'] as const
export type SearchTab = (typeof SEARCH_TABS)[number]
export interface SearchSearch {
  q?: string
  tab?: Exclude<SearchTab, 'all'>
}
export function validateSearchSearch(raw: Raw): SearchSearch {
  const tab = oneOf(raw.tab, SEARCH_TABS)
  // `q` keeps its spaces while typing (the field writes the URL as you type).
  const q = typeof raw.q === 'string' && raw.q.trim() ? raw.q : str(raw.q)
  return clean({ q, tab: tab === 'all' ? undefined : tab })
}

/* ── /product/$slug?color=&size= ─────────────────────────────────────────── */
export interface ProductSearch {
  color?: string
  size?: string
}
export function validateProductSearch(raw: Raw): ProductSearch {
  return clean({ color: str(raw.color), size: str(raw.size) })
}

/* ── /returns?order=&email= ──────────────────────────────────────────────── */
export interface ReturnsSearch {
  order?: string
  email?: string
}
export function validateReturnsSearch(raw: Raw): ReturnsSearch {
  return clean({ order: str(raw.order), email: str(raw.email) })
}

/* ── /order/$number/confirmation?email= ──────────────────────────────────── */
export interface ConfirmationSearch {
  email?: string
}
export function validateConfirmationSearch(raw: Raw): ConfirmationSearch {
  return clean({ email: str(raw.email) })
}

/* ── /reset-password?token= ──────────────────────────────────────────────── */
export interface ResetSearch {
  token?: string
}
export function validateResetSearch(raw: Raw): ResetSearch {
  return clean({ token: str(raw.token) })
}

/* ── /login?next= and /signup?next=&email= ───────────────────────────────── */
export interface LoginSearch {
  /** Raw redirect target — always pass through safeNext() (pages/auth/next.ts) before using it. */
  next?: string
}
export function validateLoginSearch(raw: Raw): LoginSearch {
  return clean({ next: str(raw.next) })
}
export interface SignupSearch extends LoginSearch {
  email?: string
}
export function validateSignupSearch(raw: Raw): SignupSearch {
  return clean({ next: str(raw.next), email: str(raw.email) })
}

/* ── /account/orders?status= ─────────────────────────────────────────────── */
export const ORDER_STATUS_FILTERS = ['open', 'completed', 'returned'] as const
export interface OrdersSearch {
  status?: (typeof ORDER_STATUS_FILTERS)[number]
}
export function validateOrdersSearch(raw: Raw): OrdersSearch {
  return clean({ status: oneOf(raw.status, ORDER_STATUS_FILTERS) })
}

/* ── Router (de)serialisers: plain URLSearchParams, no JSON encoding ──────── */
export function parseSearch(searchStr: string): Raw {
  const out: Raw = {}
  for (const [k, v] of new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)) out[k] = v
  return out
}

export function stringifySearch(search: Raw): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null) continue
    const s = Array.isArray(v) ? v.join(',') : String(v)
    if (s !== '') sp.set(k, s)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/* ── Astro pages ─────────────────────────────────────────────────────────── */
/** `Astro.url.searchParams` → the raw record the `validate*` functions take (repeated keys are joined with ","). */
export function rawSearch(sp: URLSearchParams): Raw {
  const out: Record<string, string> = {}
  for (const [k, v] of sp) out[k] = k in out ? `${out[k]},${v}` : v
  return out
}

/** A typed search object → "?a=1&b=x,y" (empty values dropped), for links that keep the current filters. */
export function searchString(search: object): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','))
    } else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
