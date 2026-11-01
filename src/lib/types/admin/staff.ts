/* Admin staff and the activity log (VAREL src/lib/admin/staff.ts). Routes: /site-api/manage/staff,
   /manage/activity (WP-26).

   D5: staff are template users whose roles grant VAREL areas (src/server/permissions.ts, PLAN.md §7);
   VAREL's StaffInvite is dropped: staff are invited from the template's Users screen. `areas` are derived
   from the codenames the member's roles grant. */
import type { PermissionArea } from '../../../server/permissions'
import type { ListParams } from './common'

export type { PermissionArea }

export interface AdminStaffMember {
  id: string // template user id
  name: string
  email: string
  /** Template role slugs (owner, admin, staff, custom roles) */
  roles: string[]
  /** Areas the member can use */
  areas: PermissionArea[]
  fullAccess: boolean
  createdAt: string
  lastActiveAt: string | null
  isYou: boolean
}

export interface AdminStaffList {
  members: AdminStaffMember[]
  /** Every area, in canonical order */
  areas: PermissionArea[]
}

export interface AdminActivityRow {
  id: string
  at: string
  actor: { id: string | null; name: string }
  action: string // "product.update"
  entity: string // "product"
  entityId: string | null
  summary: string // "Updated product Atelier Wool Coat · price, stock"
}

/** GET /site-api/manage/activity: a keyset page plus the filter choices */
export interface AdminActivityPage {
  items: AdminActivityRow[]
  nextCursor: string | null
  actors: { id: string; name: string }[]
  entities: string[]
}

export interface ActivitySearch extends ListParams {
  actor?: string
  entity?: string
  from?: string
  to?: string
}
