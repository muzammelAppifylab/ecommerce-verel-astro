/* Staff access on template roles (WP-26; port of VAREL worker/routes/admin/staff.ts helpers).

   A staff member is a template user whose roles grant at least one VAREL area (`areasOf`, src/server/permissions.ts).
   Access changes never write `user_roles` here: they are forwarded in-process to the template's own
   `PUT /site-api/admin/users/:id/roles` (`forwardRoles`), which enforces anti-escalation, protects the last owner
   and writes the audit log. Everything here is bounded: ≤ 100 roles, ≤ 100 members, ≤ 20 invitations. */
import type {Context} from 'hono';

import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import {adminRoutes, canDelegate, CORE, grants, SYSTEM_ROLES} from '../../../platform/auth';
import type {
  AdminStaffMember,
  StaffInvitation,
  StaffRoleOption,
} from '../../../lib/types/admin/staff';
import {areasOf, PERMISSION_AREAS, type PermissionArea} from '../../permissions';

/** VAREL's area labels (src/lib/admin/permissions.ts), for the invite email. */
export const AREA_LABEL: Record<PermissionArea, string> = {
  orders: 'Orders',
  customers: 'Customers',
  products: 'Products',
  content: 'Content',
  discounts: 'Discounts',
  analytics: 'Analytics',
  settings: 'Settings',
  staff: 'Staff',
};

/** Members listed at most (the rest: `truncated`, find them in Users). */
export const MAX_MEMBERS = 100;
/** Invitations shown (the last 30 days). */
export const MAX_INVITATIONS = 20;
const INVITATION_DAYS = 30;

export interface RoleInfo {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  codenames: string[];
  areas: PermissionArea[];
  /** The viewer may give or take this role. */
  assignable: boolean;
}

/** Every role with its codenames and areas, and whether `held` may hand it out. */
export async function loadRoles(db: PrismaClient, held: ReadonlySet<string>): Promise<Map<string, RoleInfo>> {
  const rows = await db.role.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isSystem: true,
      permissions: {select: {permission: {select: {codename: true}}}, take: 200},
    },
    orderBy: {id: 'asc'},
    take: 100,
  });
  return new Map(
    rows.map(r => {
      const codenames = r.permissions.map(p => p.permission.codename);
      return [
        r.slug,
        {
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          isSystem: r.isSystem,
          codenames,
          areas: areasOf(new Set(codenames)),
          assignable: r.slug !== SYSTEM_ROLES.OWNER && canDelegate(held, codenames),
        } satisfies RoleInfo,
      ];
    })
  );
}

/** The roles the drawers offer: every role except `member`, owner first as the database orders them. */
export const roleOptions = (roles: Map<string, RoleInfo>): StaffRoleOption[] =>
  [...roles.values()]
    .filter(r => r.slug !== SYSTEM_ROLES.MEMBER)
    .map(r => ({slug: r.slug, name: r.name, description: r.description, areas: r.areas, assignable: r.assignable, system: r.isSystem}));

/** The union of codenames and areas of some role slugs. */
export function accessOf(slugs: readonly string[], roles: Map<string, RoleInfo>) {
  const codenames = new Set<string>();
  for (const slug of slugs) for (const c of roles.get(slug)?.codenames ?? []) codenames.add(c);
  return {codenames, areas: areasOf(codenames)};
}

/** Does this set of role slugs grant at least one area? */
export const grantsArea = (slugs: readonly string[], roles: Map<string, RoleInfo>) => accessOf(slugs, roles).areas.length > 0;

const memberSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  createdAt: true,
  roles: {select: {role: {select: {slug: true}}}, take: 20},
} as const;

type MemberRow = Prisma.UserGetPayload<{select: typeof memberSelect}>;

export const displayName = (u: {name: string; email: string}) => u.name.trim() || u.email;

/** The latest activity row of each user: ONE statement, `activity_logs(user_id, id)` per user. */
export async function lastActivity(db: PrismaClient, ids: number[]): Promise<Map<number, Date>> {
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<{userId: number; at: Date | null}[]>(Prisma.sql`
    SELECT u.id AS "userId",
           (SELECT a.created_at FROM activity_logs a WHERE a.user_id = u.id ORDER BY a.id DESC LIMIT 1) AS "at"
    FROM unnest(${ids}::int[]) AS u(id)`);
  return new Map(rows.filter(r => r.at).map(r => [Number(r.userId), r.at!]));
}

interface Ctx {
  viewerId: number;
  held: ReadonlySet<string>;
  roles: Map<string, RoleInfo>;
}

function toMember(u: MemberRow, last: Map<number, Date>, {viewerId, held, roles}: Ctx): AdminStaffMember {
  const slugs = u.roles.map(r => r.role.slug);
  const {codenames, areas} = accessOf(slugs, roles);
  const isOwner = slugs.includes(SYSTEM_ROLES.OWNER);
  const isYou = u.id === viewerId;
  return {
    id: String(u.id),
    name: displayName(u),
    email: u.email,
    roles: slugs,
    areas,
    fullAccess: areas.length === PERMISSION_AREAS.length,
    createdAt: u.createdAt.toISOString(),
    lastActiveAt: last.get(u.id)?.toISOString() ?? null,
    isYou,
    isOwner,
    manageable: !isYou && !isOwner && grants(held, CORE.USER_UPDATE) && canDelegate(held, codenames),
    status: u.status === 'suspended' ? 'suspended' : 'active',
  };
}

/** VAREL's order: owners, then admins, then everyone else; by name within each. */
const rank = (m: AdminStaffMember) => (m.isOwner ? 0 : m.roles.includes(SYSTEM_ROLES.ADMIN) ? 1 : 2);
export const byRankThenName = (a: AdminStaffMember, b: AdminStaffMember) => rank(a) - rank(b) || a.name.localeCompare(b.name);

/** Invitations of the last 30 days (activity rows `staff.invite`), newest first, one per email, not yet members. */
export async function recentInvitations(db: PrismaClient, memberEmails: ReadonlySet<string>): Promise<StaffInvitation[]> {
  const since = new Date(Date.now() - INVITATION_DAYS * 86_400_000);
  const rows = await db.activityLog.findMany({
    where: {entity: 'staff', action: 'staff.invite', createdAt: {gte: since}},
    select: {entityId: true, actorName: true, createdAt: true},
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
    take: MAX_INVITATIONS,
  });
  const seen = new Map<string, StaffInvitation>();
  for (const r of rows) {
    const email = r.entityId?.toLowerCase();
    if (!email || seen.has(email) || memberEmails.has(email)) continue;
    seen.set(email, {email, at: r.createdAt.toISOString(), invitedBy: r.actorName, hasAccount: false});
  }
  if (!seen.size) return [];
  const accounts = await db.user.findMany({where: {email: {in: [...seen.keys()]}}, select: {email: true}, take: MAX_INVITATIONS});
  for (const a of accounts) {
    const inv = seen.get(a.email.toLowerCase());
    if (inv) inv.hasAccount = true;
  }
  return [...seen.values()];
}

/** The team: users holding a role that grants an area (≤ 100), with the latest activity of each. */
export async function loadStaff(db: PrismaClient, ctx: Ctx) {
  const areaRoleIds = [...ctx.roles.values()].filter(r => r.areas.length > 0).map(r => r.id);
  const links = areaRoleIds.length
    ? await db.userRole.findMany({
        where: {roleId: {in: areaRoleIds}},
        select: {userId: true},
        orderBy: {userId: 'asc'},
        take: MAX_MEMBERS * 5 + 1,
      })
    : [];
  const distinct = [...new Set(links.map(l => l.userId))];
  const ids = distinct.slice(0, MAX_MEMBERS);
  const [users, last] = await Promise.all([
    ids.length ? db.user.findMany({where: {id: {in: ids}}, select: memberSelect, take: MAX_MEMBERS}) : Promise.resolve([] as MemberRow[]),
    lastActivity(db, ids),
  ]);
  const members = users.map(u => toMember(u, last, ctx)).filter(m => m.areas.length > 0);
  members.sort(byRankThenName);
  return {members, truncated: distinct.length > MAX_MEMBERS};
}

/** One member (after a change), or null when the user is gone. */
export async function loadMember(db: PrismaClient, id: number, ctx: Ctx): Promise<AdminStaffMember | null> {
  const [user, last] = await Promise.all([db.user.findUnique({where: {id}, select: memberSelect}), lastActivity(db, [id])]);
  return user ? toMember(user, last, ctx) : null;
}

/** The target of a change: id, name, email and role slugs. */
export async function loadTarget(db: PrismaClient, id: number) {
  const u = await db.user.findUnique({
    where: {id},
    select: {id: true, name: true, email: true, roles: {select: {role: {select: {slug: true}}}, take: 20}},
  });
  return u ? {id: u.id, name: displayName(u), email: u.email, roles: u.roles.map(r => r.role.slug)} : null;
}

/**
 * VAREL `LAST_ADMIN`: removing the `admin` role from someone must leave the store another admin. An owner counts
 * as one (owners hold every permission). Two `take` probes, never a count.
 */
export async function wouldLeaveNoAdmin(db: PrismaClient, targetId: number): Promise<boolean> {
  const [admins, owner] = await Promise.all([
    db.userRole.findMany({where: {role: {slug: SYSTEM_ROLES.ADMIN}}, select: {userId: true}, take: 2}),
    db.userRole.findFirst({where: {role: {slug: SYSTEM_ROLES.OWNER}}, select: {userId: true}}),
  ]);
  if (owner) return false;
  return admins.filter(a => a.userId !== targetId).length === 0;
}

/** Checks a chosen role list (PATCH, invite): a field error, or the roles with their names and areas. */
export function checkChosen(
  chosen: readonly string[],
  roles: Map<string, RoleInfo>
): {error: string} | {roles: string[]; roleNames: string[]; areas: PermissionArea[]} {
  const list = [...new Set(chosen)];
  if (list.some(s => s === SYSTEM_ROLES.OWNER || s === SYSTEM_ROLES.MEMBER)) return {error: 'Pick roles from the list'};
  if (list.some(s => !roles.has(s))) return {error: 'One of those roles does not exist'};
  const {areas} = accessOf(list, roles);
  if (!areas.length) return {error: 'Choose at least one role with store access'};
  return {roles: list, roleNames: list.map(s => roles.get(s)!.name), areas};
}

/**
 * The roles to save: the chosen store roles, plus the roles the person already holds that grant NO area
 * (`member`, non-store custom roles: the Users screen manages those).
 */
export function finalRoles(current: readonly string[], chosen: readonly string[], roles: Map<string, RoleInfo>): string[] {
  const keep = current.filter(s => s !== SYSTEM_ROLES.OWNER && !grantsArea([s], roles));
  return [...new Set([...keep, ...chosen])];
}

/**
 * Change a user's roles through the template's own handler, in-process (same request scope: same viewer, same
 * memoized access; `sameOrigin`/`csrf` already ran on this request). Anti-escalation, the owner lock and the
 * `user_roles_changed` audit row are the template's. Returns its Response as it came.
 */
export function forwardRoles(c: Context, userId: number, roles: string[]): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  const url = new URL(`/users/${userId}/roles`, c.req.url);
  return Promise.resolve(adminRoutes.request(url.href, {method: 'PUT', headers, body: JSON.stringify({roles})}));
}

/** The invite email's `areas` var (VAREL): "Every area" or the labels. */
export const areasText = (areas: readonly PermissionArea[]) =>
  areas.length === PERMISSION_AREAS.length ? 'Every area' : areas.map(a => AREA_LABEL[a]).join(', ');
