/* Shared wire shapes of the Site API (docs/migration/PLAN.md §2: one contract, imported by the server
   routes, the Astro pages, the storefront islands and the portal).

   Port of VAREL `src/lib/api/types.ts` + `src/lib/admin/types.ts` (mirrored in `worker/types.ts`,
   `worker/admin-types.ts`), split per area under `src/lib/types/`. Conventions kept from VAREL so the
   storefront and admin code port unchanged:
   - Money is a NUMBER in the store currency's major unit (`148`, `24.6`), as VAREL's API returned it.
     The database keeps integer cents (F1); serializers convert (`src/server/lib/serializers.ts`, F4).
   - Ids on the wire are STRINGS (product slugs, SKUs, record ids), whatever the column type.
   - Timestamps are ISO strings; `date` fields are display strings ("18 August 2026").
   Changed for the template (AGENTS.md, docs/agent/site-api.md):
   - Errors are `{error: 'snake_code', message, fields?}` (`Problem`), not VAREL's `{error: {code, …}}`.
     VAREL's codes are kept, lower-cased (`DISCOUNT_INVALID` → `discount_invalid`); 422
     `VALIDATION_ERROR` is the template's `invalid_input`, with `fields` keyed by dotted path.
   - Admin lists are keyset pages (`CursorPage`), never totals or page numbers. */

/** Every error answer of the Site API (`src/server/lib/http.ts`). */
export interface Problem {
  error: string
  message: string
  /** 422 only: one message per field, keyed by dotted path (`variants.2.price`). */
  fields?: Record<string, string>
}

/** A keyset page: `nextCursor` is passed back as `?cursor=` for the next one; null at the end. */
export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

/** Rows per page: default and maximum (AGENTS.md: ≤ 100 rows). */
export const PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export interface Photo {
  src: string // base URL without size params; the client appends ?auto=format&fit=crop&w=…&q=80
  credit: string // "Photo by X on Unsplash"
  creditHref: string
}

/** One URL a public area adds to `/sitemap.xml` (`GET /site-api/<area>/sitemap`). */
export interface SitemapEntry {
  /** Site path with the trailing slash, e.g. `/product/forma-overshirt/`. */
  path: string
  /** ISO, or null when unknown. */
  updatedAt: string | null
}

export interface SitemapResponse {
  items: SitemapEntry[]
}

/** `{ok: true}` answers of writes that return nothing else. */
export interface Ok {
  ok: true
}
