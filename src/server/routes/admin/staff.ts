import type {Context} from 'hono';
import {Hono} from 'hono';
import {z} from 'zod';

import type {PrismaClient} from '../../../generated/prisma/client';
import type {AdminStaffList, StaffInviteResult} from '../../../lib/types/admin/staff';
import {CORE, getAccess, grants, SYSTEM_ROLES} from '../../../platform/auth';
import {config} from '../../../platform/config';
import {requirePermission, withDb} from '../../../platform/guards';
import type {Viewer} from '../../../platform/types';
import {sendTemplate} from '../../lib/contracts';
import {apiError} from '../../lib/http';
import {emailField, intId, json, params} from '../../lib/validate';
import {PERMISSION_AREAS} from '../../permissions';
import {
  areasText,
  checkChosen,
  finalRoles,
  forwardRoles,
  grantsArea,
  loadMember,
  loadRoles,
  loadStaff,
  loadTarget,
  recentInvitations,
  roleOptions,
  wouldLeaveNoAdmin,
} from './staff-access';

/**
 * Admin: Staff. WP-26 (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/staff.ts: VAREL `/api/admin/staff…` is `/site-api/manage/staff…` here.
 *
 *   GET    /site-api/manage/staff                      AdminStaffList
 *   POST   /site-api/manage/staff/invite               {email, roles} → 200 granted | 202 invited (StaffInviteResult)
 *   PATCH  /site-api/manage/staff/:id                  {roles} → AdminStaffMember
 *   DELETE /site-api/manage/staff/:id                  remove staff access → 204 (the account stays, as a customer)
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: staff = site:user:read; MANAGE_AREAS in src/server/permissions.ts), then the activity log.
 * Writes also need `site:user:update`.
 *
 * Staff are template users whose roles grant at least one VAREL area (D5). Role changes are never written here:
 * they are forwarded in-process to the template's `PUT /site-api/admin/users/:id/roles` (`forwardRoles`), which
 * enforces anti-escalation, protects the last owner and writes the audit log. VAREL's invite tokens and accept page
 * are dropped: an invite grants the roles at once to an existing account, or emails a link to the sign-up page.
 */

type Env = {Variables: {viewer: Viewer}};

const rolesField = z
  .array(z.string().trim().regex(/^[a-z][a-z0-9-]{1,47}$/, 'Pick roles from the list'), {error: 'Pick roles from the list'})
  .min(1, 'Choose at least one role with store access')
  .max(20, 'Pick at most 20 roles')
  .transform(list => [...new Set(list)]);

const idParam = z.object({id: intId('We cannot find that staff member')});

const NOT_FOUND = 'We cannot find that staff member';

/** The viewer's permissions (memoized per request by the template). */
const heldOf = async (c: Context) => new Set((await getAccess(c.req.raw)).permissions);

/** VAREL `target()` + the self/owner rules: the member to change, or the answer to send. */
async function targetOf(c: Context, viewerId: number | null, db: PrismaClient, id: number) {
  const held = await heldOf(c);
  const [target, roles] = await Promise.all([loadTarget(db, id), loadRoles(db, held)]);
  if (!target || !grantsArea(target.roles, roles)) return {error: apiError(c, 404, 'not_found', NOT_FOUND)} as const;
  if (target.id === viewerId) {
    return {error: apiError(c, 409, 'self_change', 'You cannot change your own access. Ask another admin to do it')} as const;
  }
  if (target.roles.includes(SYSTEM_ROLES.OWNER)) {
    return {error: apiError(c, 409, 'owner_managed', "Owners are set by the site's owner emails. Their access cannot be changed here")} as const;
  }
  return {target, roles, held} as const;
}

const LAST_ADMIN = 'The store needs at least one admin. Make someone else an admin first';

/** A non-2xx answer from the template handler, passed through as it came. */
const passThrough = (res: Response) => new Response(res.body, {status: res.status, headers: res.headers});

export const staffAdmin = new Hono<Env>()
  .get('/', withDb, async c => {
    const db = c.var.db;
    const held = await heldOf(c);
    const roles = await loadRoles(db, held);
    const ctx = {viewerId: c.var.viewer.id ?? 0, held, roles};
    const {members, truncated} = await loadStaff(db, ctx);
    const invitations = await recentInvitations(db, new Set(members.map(m => m.email.toLowerCase())));
    const body: AdminStaffList = {
      members,
      areas: [...PERMISSION_AREAS],
      roles: roleOptions(roles),
      invitations,
      truncated,
      canEdit: grants(held, CORE.USER_UPDATE),
    };
    return c.json(body);
  })

  // Static path before `/:id`.
  .post('/invite', json(z.object({email: emailField, roles: rolesField})), requirePermission(CORE.USER_UPDATE), withDb, async c => {
    const db = c.var.db;
    const {email, roles: chosen} = c.req.valid('json');
    const held = await heldOf(c);
    const roles = await loadRoles(db, held);
    const checked = checkChosen(chosen, roles);
    if ('error' in checked) return apiError(c, 422, 'invalid_input', checked.error, {roles: checked.error});
    const refused = checked.roles.find(slug => !roles.get(slug)!.assignable);
    if (refused) return apiError(c, 403, 'forbidden', `You cannot give the “${refused}” role.`);

    const user = await db.user.findUnique({
      where: {email},
      select: {id: true, roles: {select: {role: {select: {slug: true}}}, take: 20}},
    });
    const current = user?.roles.map(r => r.role.slug) ?? [];
    if (user && grantsArea(current, roles)) {
      return apiError(c, 409, 'already_staff', 'That person already has admin access. Change their roles instead', {email: 'Already on the team'});
    }

    const origin = (config.siteUrl ?? new URL(c.req.url).origin).replace(/\/+$/, '');
    const settings = await db.setting.findUnique({where: {id: 1}, select: {storeName: true}}).catch(() => null);
    const viewer = c.var.viewer;
    const vars = {
      inviterName: viewer.name?.trim() || viewer.email || 'An admin',
      role: checked.roleNames.join(', '),
      areas: areasText(checked.areas),
      storeName: settings?.storeName || 'VAREL',
    };

    if (user) {
      const res = await forwardRoles(c, user.id, finalRoles(current, checked.roles, roles));
      if (!res.ok) return passThrough(res);
      const inviteUrl = `${origin}/dashboard/`;
      await sendTemplate(db, 'staff_invite', email, {...vars, inviteUrl}, {requestUrl: c.req.url, related: {type: 'staff', id: email}});
      const member = await loadMember(db, user.id, {viewerId: viewer.id ?? 0, held, roles});
      const body: StaffInviteResult = {status: 'granted', email, member: member!, roleNames: checked.roleNames, areas: checked.areas};
      return c.json(body, 200);
    }

    const inviteUrl = `${origin}/account/register/`;
    await sendTemplate(db, 'staff_invite', email, {...vars, inviteUrl}, {requestUrl: c.req.url, related: {type: 'staff', id: email}});
    const body: StaffInviteResult = {status: 'invited', email, inviteUrl, roleNames: checked.roleNames, areas: checked.areas};
    return c.json(body, 202);
  })

  .patch('/:id', params(idParam), json(z.object({roles: rolesField})), requirePermission(CORE.USER_UPDATE), withDb, async c => {
    const db = c.var.db;
    const {id} = c.req.valid('param');
    const t = await targetOf(c, c.var.viewer.id, db, id);
    if ('error' in t) return t.error;
    const {target, roles, held} = t;
    const checked = checkChosen(c.req.valid('json').roles, roles);
    if ('error' in checked) return apiError(c, 422, 'invalid_input', checked.error, {roles: checked.error});
    if (target.roles.includes(SYSTEM_ROLES.ADMIN) && !checked.roles.includes(SYSTEM_ROLES.ADMIN) && (await wouldLeaveNoAdmin(db, target.id))) {
      return apiError(c, 409, 'last_admin', LAST_ADMIN);
    }
    const res = await forwardRoles(c, target.id, finalRoles(target.roles, checked.roles, roles));
    if (!res.ok) return passThrough(res);
    const member = await loadMember(db, target.id, {viewerId: c.var.viewer.id ?? 0, held, roles});
    if (!member) return apiError(c, 404, 'not_found', NOT_FOUND);
    return c.json(member);
  })

  .delete('/:id', params(idParam), requirePermission(CORE.USER_UPDATE), withDb, async c => {
    const db = c.var.db;
    const {id} = c.req.valid('param');
    const t = await targetOf(c, c.var.viewer.id, db, id);
    if ('error' in t) return t.error;
    const {target, roles} = t;
    if (target.roles.includes(SYSTEM_ROLES.ADMIN) && (await wouldLeaveNoAdmin(db, target.id))) {
      return apiError(c, 409, 'last_admin', LAST_ADMIN);
    }
    const keep = target.roles.filter(s => s !== SYSTEM_ROLES.OWNER && !grantsArea([s], roles));
    const res = await forwardRoles(c, target.id, keep.length ? keep : [SYSTEM_ROLES.MEMBER]);
    if (!res.ok) return passThrough(res);
    return c.body(null, 204);
  });

