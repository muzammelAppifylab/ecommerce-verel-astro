import {Hono} from 'hono';
import {z} from 'zod';

import {Prisma} from '../../../generated/prisma/client';
import type {Role} from '../../../lib/types/admin/common';
import type {AdminCustomer, AdminCustomerRow} from '../../../lib/types/admin/customers';
import type {AdminOrderRow, FulfillmentStatus, PaymentStatus} from '../../../lib/types/admin/sales';
import {audit, CORE} from '../../../platform/auth';
import {can, withDb} from '../../../platform/guards';
import type {Viewer} from '../../../platform/types';
import {sendTemplate} from '../../lib/contracts';
import type {Db} from '../../lib/db';
import {displayDate, monthYear, normEmail} from '../../lib/format';
import {apiError, decodeCursor, keysetPage, keysetWhere, orderByOf, pageSizeOf, parseSort, sortProblem, type Sort} from '../../lib/http';
import {fromCents, round2} from '../../lib/money';
import {anonymiseCustomer, exportFilename, exportUserData} from '../../lib/privacy';
import {serializeAddress, splitName} from '../../lib/serializers';
import {getSettings} from '../../lib/settings';
import {intId, json, multiValue, pageQuery, params, query, requiredText} from '../../lib/validate';

/**
 * Admin: Customers (port of VAREL worker/routes/admin/customers.ts): VAREL `/api/admin/customers…` is
 * `/site-api/manage/customers…` here. Every account, any role (customers are template users with a
 * `CustomerProfile`, PLAN.md D5).
 *
 *   GET    /site-api/manage/customers                  CursorPage<AdminCustomerRow> ?q&role&sort&cursor&pageSize
 *   GET    /site-api/manage/customers/:id              AdminCustomer
 *   PATCH  /site-api/manage/customers/:id              profile fields → AdminCustomer (roles change through the template users API)
 *   GET    /site-api/manage/customers/:id/export       CustomerExport (attachment; needs site:user:update)
 *   DELETE /site-api/manage/customers/:id              {confirmEmail} → anonymise + delete the account → 204; 409 not_a_customer
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: customers = site:customer:manage), then the activity log. Export and delete were VAREL
 * `requireAdmin`: here `can(c, CORE.USER_UPDATE)` (held by admins and owners, not by staff).
 *
 * Differences from VAREL: keyset pages (no totals, no in-memory sort; the orders/spent/last-order/role
 * sorts are gone), stats computed for the page only in ONE query, `PATCH {role}` replaced by a profile
 * edit (roles have their own anti-escalation rules in the template), the delete removes the `users` row
 * (the template has no soft delete) after anonymising the shop data, and the typed email confirmation
 * is checked on the server too.
 */

type Env = {Variables: {viewer: Viewer}};

export const CUSTOMER_ROLES = ['customer', 'staff', 'admin'] as const satisfies readonly Role[];
export const CUSTOMER_SORT_FIELDS = ['createdAt', 'email', 'name'] as const;
type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

const ADMIN_SLUGS = ['owner', 'admin'];
const NOT_FOUND = 'We cannot find that customer';

/**
 * VAREL's `User.role` from the template roles an account holds (display and filtering only; never
 * used to authorise): owner/admin → admin; any other role than `member` → staff; else customer.
 */
export function deriveRole(slugs: readonly string[]): Role {
  if (slugs.some(s => ADMIN_SLUGS.includes(s))) return 'admin';
  if (slugs.some(s => s !== 'member')) return 'staff';
  return 'customer';
}

/** The `users` filter for a role filter (OR of the chosen roles), mirroring `deriveRole`. */
export function roleWhere(roles: readonly Role[]): Prisma.UserWhereInput {
  const one: Record<Role, Prisma.UserWhereInput> = {
    admin: {roles: {some: {role: {slug: {in: ADMIN_SLUGS}}}}},
    staff: {
      AND: [{roles: {some: {role: {slug: {notIn: [...ADMIN_SLUGS, 'member']}}}}}, {roles: {none: {role: {slug: {in: ADMIN_SLUGS}}}}}],
    },
    customer: {roles: {none: {role: {slug: {not: 'member'}}}}},
  };
  const chosen = [...new Set(roles)];
  if (!chosen.length || chosen.length === CUSTOMER_ROLES.length) return {};
  return chosen.length === 1 ? one[chosen[0]!] : {OR: chosen.map(r => one[r])};
}

/** Search words (at most 5): each matches the email, account name, profile names or phone; words are ANDed. */
export function customerSearchWhere(q: string | undefined): Prisma.UserWhereInput {
  const words = (q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return {};
  const ci = (w: string) => ({contains: w, mode: 'insensitive' as const});
  return {
    AND: words.map(w => ({
      OR: [
        {email: ci(w)},
        {name: ci(w)},
        {customerProfile: {is: {firstName: ci(w)}}},
        {customerProfile: {is: {lastName: ci(w)}}},
        {customerProfile: {is: {phone: {contains: w}}}},
      ],
    })),
  };
}

const customerSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  customerProfile: {select: {firstName: true, lastName: true, phone: true, marketingOptIn: true, locale: true}},
  roles: {select: {role: {select: {slug: true}}}, take: 20},
} as const;
type CustomerUser = Prisma.UserGetPayload<{select: typeof customerSelect}>;

export interface CustomerStats {
  orders: number;
  spent: number;
  lastOrderAt: Date | null;
}

const NO_STATS: CustomerStats = {orders: 0, spent: 0, lastOrderAt: null};

/**
 * Orders and spend per account (VAREL `statsFor`), in ONE query for the page: linked orders plus guest
 * orders placed with the same email; spend counts Paid orders; last order is the newest of any status.
 */
async function statsFor(db: Db, users: readonly {id: number; email: string}[]): Promise<Map<number, CustomerStats>> {
  const out = new Map<number, CustomerStats>();
  if (!users.length) return out;
  const ids = users.map(u => u.id);
  const pairs = users.map(u => Prisma.sql`(${u.id}::int, ${normEmail(u.email)}::text)`);
  const rows = await db.$queryRaw<{uid: number; orders: number; spent_cents: bigint | number | null; last_order_at: Date | null}[]>`
    SELECT k.uid, COUNT(*)::int AS orders,
           COALESCE(SUM(k.total_cents) FILTER (WHERE k.payment = 'Paid'), 0)::bigint AS spent_cents,
           MAX(k.placed_at) AS last_order_at
      FROM (
        SELECT o.user_id AS uid, o.total_cents, o.payment, o.placed_at
          FROM shop_orders o WHERE o.user_id IN (${Prisma.join(ids)})
        UNION ALL
        SELECT u.id AS uid, o.total_cents, o.payment, o.placed_at
          FROM shop_orders o JOIN (VALUES ${Prisma.join(pairs)}) AS u(id, email) ON o.email = u.email
         WHERE o.user_id IS NULL
      ) k
     GROUP BY k.uid`;
  for (const r of rows) {
    out.set(Number(r.uid), {orders: Number(r.orders), spent: round2(fromCents(Number(r.spent_cents ?? 0))), lastOrderAt: r.last_order_at});
  }
  return out;
}

const slugsOf = (u: CustomerUser) => u.roles.map(r => r.role.slug);

/** Profile first + last → account name → email (accounts made before onboarding have no profile). */
function nameOf(u: Pick<CustomerUser, 'name' | 'email' | 'customerProfile'>): string {
  const p = u.customerProfile;
  const full = p ? `${p.firstName} ${p.lastName}`.trim() : '';
  return full || u.name.trim() || u.email;
}

function customerRow(u: CustomerUser, stats: CustomerStats | undefined, subscribed: boolean): AdminCustomerRow {
  const s = stats ?? NO_STATS;
  return {
    id: String(u.id),
    name: nameOf(u),
    email: u.email,
    role: deriveRole(slugsOf(u)),
    since: monthYear(u.createdAt),
    createdAt: u.createdAt.toISOString(),
    orders: s.orders,
    spent: s.spent,
    lastOrderAt: s.lastOrderAt ? s.lastOrderAt.toISOString() : null,
    newsletter: Boolean(u.customerProfile?.marketingOptIn) || subscribed,
  };
}

/** Which of these accounts' emails are on the newsletter list. */
async function subscribedEmails(db: Db, users: readonly {email: string}[]): Promise<Set<string>> {
  if (!users.length) return new Set();
  const rows = await db.newsletterSubscriber.findMany({
    where: {email: {in: users.map(u => normEmail(u.email))}},
    select: {email: true},
    take: 100,
  });
  return new Set(rows.map(r => r.email));
}

const recentOrderSelect = {
  number: true,
  placedAt: true,
  email: true,
  userId: true,
  payment: true,
  fulfillment: true,
  totalCents: true,
  currency: true,
  address: true,
  items: {select: {qty: true}, take: 100},
  user: {select: {name: true, customerProfile: {select: {firstName: true, lastName: true}}}},
} as const;
type RecentOrder = Prisma.ShopOrderGetPayload<{select: typeof recentOrderSelect}>;

/** The orders list row (same output as WP-19's `adminOrderRow`; VAREL `adminOrderRow`). */
export function orderRow(o: RecentOrder): AdminOrderRow {
  const p = o.user?.customerProfile;
  const profileName = p ? `${p.firstName} ${p.lastName}`.trim() : '';
  const address = o.address && typeof o.address === 'object' && !Array.isArray(o.address) ? (o.address as {name?: unknown}) : null;
  const addressName = typeof address?.name === 'string' ? address.name.trim() : '';
  return {
    number: o.number,
    placedAt: o.placedAt.toISOString(),
    date: displayDate(o.placedAt),
    customerName: profileName || o.user?.name.trim() || addressName || o.email,
    email: o.email,
    customerId: o.userId ? String(o.userId) : null,
    payment: o.payment as PaymentStatus,
    fulfillment: o.fulfillment as FulfillmentStatus,
    total: fromCents(o.totalCents),
    count: o.items.reduce((n, i) => n + i.qty, 0),
    currency: o.currency,
  };
}

/** Most wishlist pieces read for the detail (no count(): "100+" at the cap). */
export const WISHLIST_CAP = 100;

async function customerDetail(db: Db, id: number): Promise<AdminCustomer | null> {
  const u = await db.user.findUnique({where: {id}, select: customerSelect});
  if (!u) return null;
  const email = normEmail(u.email);
  const [stats, recent, addresses, wishlist, subscriber] = await Promise.all([
    statsFor(db, [u]),
    db.shopOrder.findMany({
      where: {OR: [{userId: id}, {userId: null, email}]},
      orderBy: [{placedAt: 'desc'}, {id: 'desc'}],
      take: 10,
      select: recentOrderSelect,
    }),
    db.address.findMany({where: {userId: id}, orderBy: [{primary: 'desc'}, {createdAt: 'asc'}, {id: 'asc'}], take: 20}),
    db.wishlistItem.findMany({where: {userId: id}, select: {id: true}, take: WISHLIST_CAP}),
    db.newsletterSubscriber.findUnique({where: {email}, select: {id: true}}),
  ]);
  return {
    ...customerRow(u, stats.get(u.id), subscriber != null),
    phone: u.customerProfile?.phone ?? null,
    addresses: addresses.map(serializeAddress),
    recentOrders: recent.map(orderRow),
    wishlistCount: wishlist.length,
  };
}

const listQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  role: multiValue(3),
  sort: z.string().trim().max(40).optional(),
  ...pageQuery,
});

const idParam = z.object({id: intId(NOT_FOUND)});

const profileBody = z.object({
  firstName: requiredText('a first name', 80).optional(),
  lastName: z.string({error: 'Check this field'}).trim().max(80, 'Keep the last name under 80 characters').optional(),
  phone: z
    .string({error: 'Check this field'})
    .trim()
    .max(40, 'Keep the phone number under 40 characters')
    .nullable()
    .optional()
    .transform(v => (v === undefined ? undefined : v || null)),
});

const deleteBody = z.object({confirmEmail: z.string({error: 'Type the customer’s email to confirm'}).trim().max(254)});

/** VAREL `requireAdmin`: export and delete need `site:user:update` (admins, owners), checked on the codename. */
const mayChangeUsers = (c: unknown) => can(c as Parameters<typeof can>[0], CORE.USER_UPDATE);

const cursorOf = (sort: Sort<CustomerSortField>, u: CustomerUser) =>
  [sort.field === 'createdAt' ? u.id : sort.field === 'email' ? u.email : u.name, u.id] as const;

/** The keyset filter after a cursor for the chosen sort (createdAt walks the id: ids rise with created_at). */
function afterCursor(sort: Sort<CustomerSortField>, cursor: string | undefined): Prisma.UserWhereInput {
  const after = decodeCursor(cursor);
  if (!after || typeof after[1] !== 'number') return {};
  const id = after[1];
  if (sort.field === 'createdAt') return keysetWhere('id', sort.dir, [id, id]);
  return typeof after[0] === 'string' ? keysetWhere(sort.field, sort.dir, [after[0], id]) : {};
}

export const customersAdmin = new Hono<Env>()
  .get('/', query(listQuery), withDb, async c => {
    const q = c.req.valid('query');
    const bad = q.role.filter(r => !(CUSTOMER_ROLES as readonly string[]).includes(r));
    if (bad.length) return apiError(c, 422, 'invalid_input', 'Check the highlighted fields', {role: 'Use customer, staff, admin'});
    const sort = parseSort(q.sort, CUSTOMER_SORT_FIELDS, '-createdAt');
    if (!sort) return apiError(c, 422, 'invalid_input', 'Check the highlighted fields', sortProblem(CUSTOMER_SORT_FIELDS));
    const size = pageSizeOf(q.pageSize);
    const db = c.var.db;
    const users = await db.user.findMany({
      where: {AND: [roleWhere(q.role as Role[]), customerSearchWhere(q.q), afterCursor(sort, q.cursor)]},
      orderBy: sort.field === 'createdAt' ? [{id: sort.dir}] : orderByOf(sort.field, sort.dir),
      take: size + 1,
      select: customerSelect,
    });
    const shown = users.slice(0, size);
    const [stats, subscribed] = await Promise.all([statsFor(db, shown), subscribedEmails(db, shown)]);
    const page = keysetPage(users, size, u => cursorOf(sort, u));
    return c.json({
      items: page.items.map(u => customerRow(u, stats.get(u.id), subscribed.has(normEmail(u.email)))),
      nextCursor: page.nextCursor,
    });
  })

  .get('/:id', params(idParam), withDb, async c => {
    const customer = await customerDetail(c.var.db, c.req.valid('param').id);
    if (!customer) return apiError(c, 404, 'not_found', NOT_FOUND);
    return c.json(customer);
  })

  /** Edit the shop profile (first/last name, phone). Never touches `users` (name and email are the account's). */
  .patch('/:id', params(idParam), json(profileBody), withDb, async c => {
    const {id} = c.req.valid('param');
    const body = c.req.valid('json');
    const given = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
    };
    if (!Object.keys(given).length) return apiError(c, 422, 'invalid_input', 'Change at least one field');
    const db = c.var.db;
    const user = await db.user.findUnique({where: {id}, select: {id: true, name: true}});
    if (!user) return apiError(c, 404, 'not_found', NOT_FOUND);
    const split = splitName(user.name);
    const write = () =>
      db.customerProfile.upsert({
        where: {userId: id},
        create: {
          userId: id,
          firstName: given.firstName ?? split.firstName,
          lastName: given.lastName ?? split.lastName,
          phone: given.phone ?? null,
        },
        update: given,
        select: {id: true},
      });
    try {
      await write();
    } catch (err) {
      // Two saves creating the profile at once: the loser updates the winner's row.
      if ((err as {code?: unknown}).code !== 'P2002') throw err;
      await db.customerProfile.update({where: {userId: id}, data: given, select: {id: true}});
    }
    return c.json((await customerDetail(db, id))!);
  })

  .get('/:id/export', params(idParam), withDb, async c => {
    if (!(await mayChangeUsers(c))) return apiError(c, 403, 'forbidden', 'Only admins can export customer data');
    const {id} = c.req.valid('param');
    const db = c.var.db;
    const u = await db.user.findUnique({where: {id}, select: customerSelect});
    if (!u) return apiError(c, 404, 'not_found', NOT_FOUND);
    const data = await exportUserData(db, {id: u.id, email: u.email, name: u.name, createdAt: u.createdAt, updatedAt: u.updatedAt}, slugsOf(u));
    await audit(db, {actorUserId: c.var.viewer.id, action: 'customer_data_exported', target: ['user', id]});
    c.header('Content-Disposition', `attachment; filename="${exportFilename(u)}"`);
    c.header('Cache-Control', 'private, no-store');
    return c.json(data);
  })

  .delete('/:id', params(idParam), json(deleteBody), withDb, async c => {
    if (!(await mayChangeUsers(c))) return apiError(c, 403, 'forbidden', 'Only admins can delete customers');
    const {id} = c.req.valid('param');
    const {confirmEmail} = c.req.valid('json');
    const db = c.var.db;
    const u = await db.user.findUnique({where: {id}, select: customerSelect});
    if (!u) return apiError(c, 404, 'not_found', NOT_FOUND);
    if (normEmail(confirmEmail) !== normEmail(u.email)) {
      return apiError(c, 422, 'invalid_input', 'Check the highlighted fields', {confirmEmail: 'The email does not match'});
    }
    if (id === c.var.viewer.id || deriveRole(slugsOf(u)) !== 'customer') {
      return apiError(c, 409, 'not_a_customer', 'Change this account to a customer before deleting it');
    }
    // The goodbye email goes to the real address BEFORE it is erased (VAREL order). Never throws.
    const settings = await getSettings(db);
    const firstName = u.customerProfile?.firstName || splitName(u.name).firstName;
    await sendTemplate(
      db,
      'account_deleted',
      u.email,
      {firstName, storeName: settings.storeName, supportEmail: settings.supportEmail},
      {related: {type: 'user', id: String(id)}, locale: u.customerProfile?.locale, requestUrl: c.req.url}
    );
    // Shop data anonymised (orders kept with the email masked), then the account itself removed: its roles,
    // refresh tokens and codes cascade, so they are signed out everywhere (what /auth/delete-account does).
    await db.$transaction(async tx => {
      await anonymiseCustomer(tx, {id, email: u.email});
      await tx.user.delete({where: {id}, select: {id: true}});
    });
    // No email or name in the audit row: the point is erasure. The staff activity row comes from the
    // activity middleware (`customer.delete`).
    await audit(db, {actorUserId: c.var.viewer.id, action: 'customer_deleted', target: ['user', id]});
    return c.body(null, 204);
  });

