/* Storefront analytics beacon (D11, docs/PHASE2-3.md §8, VAREL worker/routes/events.ts).
   POST /site-api/events (events.ts, WP-16): consent-gated, batched, always 204. The visitor and user come
   from the request (visitor cookie, session), never the body. Purchases are read from orders. */

export const EVENT_TYPES = ['page_view', 'product_view', 'add_to_cart', 'checkout_start', 'search'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface TrackedEvent {
  type: EventType
  path?: string // ≤ 300
  productId?: string // ≤ 120
  query?: string // ≤ 120
  results?: number // 0–100000
}

/** 1–20 events a request */
export interface EventBatch {
  events: TrackedEvent[]
}

/** GET /site-api/i18n/catalog/:locale/:ns (i18n.ts, WP-15 / WP-25) */
export interface I18nCatalogResponse {
  locale: string
  ns: string
  catalog: Record<string, unknown>
  /** true when the English catalog was served instead */
  fallback?: boolean
}
