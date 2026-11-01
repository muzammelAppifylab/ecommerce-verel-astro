/* Admin staff and the activity log (VAREL src/lib/admin/staff.ts). Routes: /site-api/manage/staff,
   /manage/activity (WP-26).

   D5: staff are template users whose roles grant VAREL areas (src/server/permissions.ts, PLAN.md §7);
   VAREL's StaffInvite is dropped: `POST /manage/staff/invite` grants roles to an existing account or emails a
   sign-up link (WP-26). `areas` are derived
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
  /** Holds the `owner` role (set by the site's owner emails; never changed here) */
  isOwner: boolean
  /** The viewer may change this person's access (not themselves, not an owner, nothing they outrank) */
  manageable: boolean
  /** Template account status */
  status: 'active' | 'suspended'
}

/** A template role offered in the Staff drawers (every role except `member`). */
export interface StaffRoleOption {
  slug: string
  name: string
  description: string | null
  /** Areas the role grants on its own */
  areas: PermissionArea[]
  /** The viewer may hand this role out (holds every permission in it; never `owner`) */
  assignable: boolean
  system: boolean
}

/** An invitation sent in the last 30 days (from the activity log; there is no invite token, D5). */
export interface StaffInvitation {
  email: string
  at: string
  invitedBy: string
  /** The email has an account now: the admin can add it to the team */
  hasAccount: boolean
}

/** PATCH /site-api/manage/staff/:id */
export interface StaffAccessInput {
  roles: string[]
}

/** POST /site-api/manage/staff/invite */
export interface StaffInviteInput {
  email: string
  roles: string[]
}

export type StaffInviteResult =
  | { status: 'granted'; email: string; member: AdminStaffMember; roleNames: string[]; areas: PermissionArea[] }
  | { status: 'invited'; email: string; inviteUrl: string; roleNames: string[]; areas: PermissionArea[] }

export interface AdminStaffList {
  members: AdminStaffMember[]
  /** Every area, in canonical order */
  areas: PermissionArea[]
  /** Every role except `member`, for the drawers */
  roles: StaffRoleOption[]
  /** Invitations of the last 30 days whose email is not on the team (≤ 20) */
  invitations: StaffInvitation[]
  /** More than 100 people hold an area (the first 100 are listed) */
  truncated: boolean
  /** The viewer may change access (site:user:update) */
  canEdit: boolean
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
