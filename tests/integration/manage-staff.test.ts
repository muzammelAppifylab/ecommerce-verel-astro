import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {wouldLeaveNoAdmin} from '../../src/server/routes/admin/staff-access';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** `/site-api/manage/staff` (WP-26): the team on template roles, changes forwarded to the template's role handler. */
describe.skipIf(!DATABASE_URL)('manage staff (integration, real Postgres)', () => {
  let owner: Browser;
  let admin: Browser;
  let customer: Browser;
  let adminId: number;
  let customerId: number;

  const rolesOf = async (id: number) =>
    (await db.userRole.findMany({where: {userId: id}, select: {role: {select: {slug: true}}}})).map(r => r.role.slug).sort();

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    admin = await signedIn(app, 'admin@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    adminId = await userId('admin@example.test');
    customerId = await userId('customer@example.test');
    const made = await owner.request('PUT', `/site-api/admin/users/${adminId}/roles`, {roles: ['member', 'admin']});
    expect(made.status).toBe(200);
  }, 120_000);

  it('only people with the staff area read the team', async () => {
    expect((await customer.get('/site-api/manage/staff')).status).toBe(403);
    const staffId = customerId;
    await owner.request('PUT', `/site-api/admin/users/${staffId}/roles`, {roles: ['member', 'staff']});
    expect((await customer.get('/site-api/manage/staff')).status).toBe(403);
    expect((await customer.get('/site-api/manage/activity')).status).toBe(403);
    expect((await owner.get('/site-api/manage/staff')).status).toBe(200);
  });

  it('lists owners first, then admins, with roles, areas and who may be changed', async () => {
    const res = await owner.get('/site-api/manage/staff');
    expect(res.status).toBe(200);
    const list = res.json as {
      members: {email: string; isYou: boolean; isOwner: boolean; manageable: boolean; fullAccess: boolean; roles: string[]}[];
      roles: {slug: string; assignable: boolean}[];
      canEdit: boolean;
      truncated: boolean;
      areas: string[];
    };
    expect(list.members.map(m => m.email)).toEqual(['owner@example.test', 'admin@example.test']);
    expect(list.members[0]).toMatchObject({isYou: true, isOwner: true, manageable: false, fullAccess: true});
    expect(list.members[1]).toMatchObject({isYou: false, isOwner: false, manageable: true, fullAccess: true});
    expect(list.roles.map(r => r.slug)).not.toContain('member');
    expect(list.roles.find(r => r.slug === 'owner')?.assignable).toBe(false);
    expect(list.roles.find(r => r.slug === 'staff')?.assignable).toBe(true);
    expect(list).toMatchObject({canEdit: true, truncated: false});
    expect(list.areas).toHaveLength(8);
  });

  it('PATCH forwards to the template: roles change, audit and activity rows are written', async () => {
    // Make the customer staff first (through the invite of an existing account).
    const granted = await owner.post('/site-api/manage/staff/invite', {email: 'Customer@Example.test', roles: ['staff']});
    expect(granted.status).toBe(200);
    expect(granted.json).toMatchObject({status: 'granted', email: 'customer@example.test'});
    expect(await rolesOf(customerId)).toEqual(['member', 'staff']);

    const res = await owner.request('PATCH', `/site-api/manage/staff/${customerId}`, {roles: ['admin']});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({id: String(customerId), roles: expect.arrayContaining(['admin', 'member']), fullAccess: true});
    expect(await rolesOf(customerId)).toEqual(['admin', 'member']);

    const audits = await db.auditEvent.findMany({where: {action: 'user_roles_changed', targetId: String(customerId)}, orderBy: {id: 'asc'}});
    expect(audits.at(-1)?.meta).toMatchObject({added: ['admin'], removed: ['staff']});
    const rows = await db.activityLog.findMany({where: {entity: 'staff'}, orderBy: {id: 'asc'}});
    expect(rows.map(r => r.action)).toEqual(['staff.grant', 'staff.update']);
    expect(rows[1]!.summary).toBe('Changed access for customer · roles admin');
    expect(rows[1]!.userId).toBe(await userId('owner@example.test'));
  });

  it('refuses self changes, owners, people without areas and bad role lists', async () => {
    const ownerId = await userId('owner@example.test');
    expect((await admin.request('PATCH', `/site-api/manage/staff/${adminId}`, {roles: ['staff']})).json).toMatchObject({error: 'self_change'});
    expect((await admin.request('PATCH', `/site-api/manage/staff/${ownerId}`, {roles: ['staff']})).json).toMatchObject({error: 'owner_managed'});
    expect((await owner.request('PATCH', `/site-api/manage/staff/${customerId}`, {roles: ['staff']})).status).toBe(404);
    const bad = await owner.request('PATCH', `/site-api/manage/staff/${adminId}`, {roles: ['owner']});
    expect(bad.status).toBe(422);
    expect(bad.json).toMatchObject({fields: {roles: 'Pick roles from the list'}});
    expect((await owner.request('PATCH', `/site-api/manage/staff/${adminId}`, {roles: []})).status).toBe(422);
    expect((await owner.request('PATCH', `/site-api/manage/staff/${adminId}`, {roles: ['nope-role']})).json).toMatchObject({
      fields: {roles: 'One of those roles does not exist'},
    });
    expect(await rolesOf(adminId)).toEqual(['admin', 'member']);
    // No rows for refused writes.
    expect(await db.activityLog.count()).toBe(0);
  });

  it('keeps the last admin when there is no owner (an owner counts as one)', async () => {
    const ownerId = await userId('owner@example.test');
    expect(await wouldLeaveNoAdmin(db as never, adminId)).toBe(false); // the owner counts
    await db.userRole.deleteMany({where: {userId: ownerId, role: {slug: 'owner'}}});
    expect(await wouldLeaveNoAdmin(db as never, adminId)).toBe(true);
    const adminRole = await db.role.findUniqueOrThrow({where: {slug: 'admin'}, select: {id: true}});
    await db.userRole.create({data: {userId: customerId, roleId: adminRole.id}});
    expect(await wouldLeaveNoAdmin(db as never, adminId)).toBe(false);
  });

  it('DELETE keeps the account and its non-store roles', async () => {
    const res = await owner.delete(`/site-api/manage/staff/${adminId}`);
    expect(res.status).toBe(204);
    expect(await rolesOf(adminId)).toEqual(['member']);
    const row = await db.activityLog.findFirst({where: {action: 'staff.remove'}});
    expect(row?.summary).toBe('Removed staff access for admin');
    expect((await db.user.findUnique({where: {id: adminId}, select: {id: true}}))?.id).toBe(adminId);
  });

  it('invites: an existing teammate is refused, an unknown email gets a sign-up link and shows as an invitation', async () => {
    const dup = await owner.post('/site-api/manage/staff/invite', {email: 'admin@example.test', roles: ['staff']});
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({error: 'already_staff', fields: {email: 'Already on the team'}});

    const res = await owner.post('/site-api/manage/staff/invite', {email: 'new.person@example.test', roles: ['staff']});
    expect(res.status).toBe(202);
    expect(res.json).toMatchObject({status: 'invited', email: 'new.person@example.test', roleNames: [expect.any(String)]});
    expect(String(res.json.inviteUrl)).toMatch(/\/account\/register\/$/);
    const row = await db.activityLog.findFirst({where: {action: 'staff.invite'}});
    expect(row).toMatchObject({entity: 'staff', entityId: 'new.person@example.test'});

    const list = await owner.get('/site-api/manage/staff');
    expect(list.json.invitations).toEqual([
      expect.objectContaining({email: 'new.person@example.test', hasAccount: false}),
    ]);

    const bad = await owner.post('/site-api/manage/staff/invite', {email: 'nope', roles: ['staff']});
    expect(bad.status).toBe(422);
    expect(bad.json).toMatchObject({fields: {email: 'Enter a valid email address'}});
  });

  it('a staff admin without every permission cannot hand out admin (template anti-escalation)', async () => {
    // A custom role with the user admin but not orders.
    const people = await owner.post('/site-api/admin/roles', {
      slug: 'people',
      name: 'People',
      permissions: ['site:user:read', 'site:user:update', 'site:customer:manage'],
    });
    expect([200, 201]).toContain(people.status);
    await owner.request('PUT', `/site-api/admin/users/${customerId}/roles`, {roles: ['member', 'people']});
    const target = await signedIn(app, 'target@example.test', undefined, '203.0.113.24');
    void target;
    const targetId = await userId('target@example.test');
    await owner.request('PUT', `/site-api/admin/users/${targetId}/roles`, {roles: ['member', 'staff']});
    const res = await customer.request('PATCH', `/site-api/manage/staff/${targetId}`, {roles: ['admin']});
    expect(res.status).toBe(403);
    expect(await rolesOf(targetId)).toEqual(['member', 'staff']);
  });
});
