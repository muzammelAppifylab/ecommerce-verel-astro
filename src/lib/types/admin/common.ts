/* Shared pieces of the admin contract (VAREL src/lib/admin/types.ts).
   Every admin route lives under `/site-api/manage/<area>` (src/server/routes/admin/index.ts), behind
   `withViewer → requireAuth → area check` (PERMISSIONS in src/server/permissions.ts, PLAN.md §7).

   Lists: VAREL returned `Page<T>` = `{items, total, page, pageSize}` (offset paging). The template forbids
   offset paging and per-request counts, so admin lists answer `CursorPage<T>` = `{items, nextCursor}`
   (src/lib/types/common.ts) and take `?cursor=&pageSize=` (≤ 100) next to their filters and `sort`.
   The portal shows them with `DataTable` + `LoadMore` (PLAN.md §6). */
export type { CursorPage, Photo, Problem } from '../common'

/** VAREL `User.role`, derived from the template roles of the account (owner/admin → admin, staff → staff). */
export type Role = 'customer' | 'staff' | 'admin'

/** Query of every keyset list. */
export interface ListParams {
  q?: string
  sort?: string // a whitelisted field, `-` prefix for descending
  cursor?: string
  pageSize?: number
}

/** Bulk actions run one request per item from the portal; this is their summary. */
export interface BulkOutcome<T> {
  done: T[]
  failed: { key: string; error: unknown }[]
}
