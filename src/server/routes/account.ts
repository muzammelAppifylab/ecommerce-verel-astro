import {Hono, type Context} from 'hono';
import {z} from 'zod';

import {getAccess} from '../../platform/auth';
import {requireAuth, withDb, withViewer} from '../../platform/guards';
import {wishlistIds} from '../lib/cart';
import {sendTemplate} from '../lib/contracts';
import {canonicalCountry, isKnownCountry} from '../lib/countries';
import type {Db} from '../lib/db';
import {normEmail} from '../lib/format';
import {apiError} from '../lib/http';
import {locOf} from '../lib/i18n/localize';
import {localeOf} from '../lib/locale';
import {ownedBy} from '../lib/orders';
import {anonymiseCustomer, DELETED_NAME, deletedEmail, exportFilename, exportUserData, maskEmail} from '../lib/privacy';
import {orderInclude, serializeAddress, serializeOrder, serializeUser, splitName} from '../lib/serializers';
import {getSettings} from '../lib/settings';
import {json, params, requiredText} from '../lib/validate';
import {readVisitorId, VISITOR_COOKIE, visitorCookieOptions} from '../lib/visitor';
import {rateLimit} from '../lib/rate-limit';

/**
 * Customer account (WP-13, PLAN.md §5). Port of VAREL worker/routes/account.ts.
 *
 *   GET    /site-api/account/overview                  AccountOverview & {orderCount}
 *   PATCH  /site-api/account/profile                   ProfileInput → {user: AccountUser}
 *   PATCH  /site-api/account/preferences               PreferencesInput → {user: AccountUser}
 *   GET    /site-api/account/addresses                 Address[] (≤ 50)
 *   POST   /site-api/account/addresses                 AddressInput → 201 Address
 *   PATCH  /site-api/account/addresses/:id             Partial<AddressInput> → Address
 *   DELETE /site-api/account/addresses/:id             204
 *   GET    /site-api/account/export                    CustomerExport (attachment)
 *   POST   /site-api/account/delete                    {password, confirm:'DELETE'} → the template deletes the
 *                                                      sign-in, then the shop data is anonymised → 200
 *
 * Signed in only (`withViewer, requireAuth`); every query is scoped by `c.var.viewer.id` (the viewer's own
 * records: no permission codename). Password, email change and sessions are the template's
 * (`/site-api/auth/*`, D5): VAREL's `POST /account/password` and the profile's email field are gone.
 * Several modules share the `/account` prefix (routes/i18n.ts): middleware goes on each route, never `.use('*')`.
 */

/** Most saved addresses per customer (VAREL had no bound). */
export const MAX_ADDRESSES = 50;
/** Rows linked to an account by id, collected before it is deleted and masked afterwards. */
const LINKED_LIMIT = 500;

const PROFILE_SELECT = {
  id: true,
  userId: true,
  firstName: true,
  lastName: true,
  phone: true,
  locale: true,
  marketingOptIn: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ADDRESS_SELECT = {
  id: true,
  userId: true,
  label: true,
  name: true,
  line1: true,
  line2: true,
  city: true,
  zip: true,
  country: true,
  phone: true,
  primary: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ACCOUNT_SELECT = {id: true, email: true, name: true, createdAt: true} as const;

/** The overview's order rows: VAREL's include, with the items bounded. */
const OVERVIEW_ORDER_INCLUDE = {
  ...orderInclude,
  items: {orderBy: {position: 'asc' as const}, take: 100},
};

const ADDRESS_ORDER = [{primary: 'desc' as const}, {createdAt: 'asc' as const}, {id: 'asc' as const}];

// ─── Schemas (exported for the unit tests) ───────────────────────────────────

/** Trimmed text, `''`/missing → null, with a field-specific length message. */
const optional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform(v => (v ? v : null));

export const profileBody = z.object({
  firstName: requiredText('your first name', 80),
  lastName: requiredText('your last name', 80),
  phone: optional(40, 'Keep the phone number under 40 characters'),
});

export const preferencesBody = z.object({newsletter: z.boolean({error: 'Use true or false'})});

const addressFields = {
  label: optional(40, 'Keep the label under 40 characters'),
  name: requiredText('the full name', 120),
  line1: requiredText('the street address', 200),
  line2: optional(200, 'Keep this line under 200 characters'),
  city: requiredText('the city', 100),
  zip: requiredText('the postcode', 20),
  country: requiredText('the country', 80).refine(isKnownCountry, 'Choose a country we ship to').transform(canonicalCountry),
  phone: optional(40, 'Keep the phone number under 40 characters'),
  primary: z.boolean().optional(),
};

export const addressBody = z.object(addressFields);
export const addressPatch = z.object(addressFields).partial();
export const addressParam = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d{0,9}$/, 'We cannot find that address')
    .transform(Number)
    .refine(n => n <= 2_147_483_647, 'We cannot find that address'),
});

export const deleteBody = z.object({
  // Empty for accounts that sign in with an emailed code (the template then asks for nothing more).
  password: z.string().max(400).default(''),
  confirm: z.string().trim().max(16).default(''),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const noStore = (c: Context) => c.header('Cache-Control', 'private, no-store');
const signedOut = (c: Context) => apiError(c, 401, 'signed_out', 'Sign in first.');
const notFoundAddress = (c: Context) => apiError(c, 404, 'not_found', 'We cannot find that address');

/** The remembered storefront language for a first profile row. */
async function profileLocale(c: Context): Promise<string> {
  try {
    return (await localeOf(c)).slice(0, 10);
  } catch {
    return 'en';
  }
}

async function accountUser(c: Context, db: Db, id: number) {
  const [row, profile, loc] = await Promise.all([
    db.user.findUnique({where: {id}, select: ACCOUNT_SELECT}),
    db.customerProfile.findUnique({where: {userId: id}, select: PROFILE_SELECT}),
    locOf(c),
  ]);
  return row ? serializeUser(row, profile, loc) : null;
}

/** `visitor_id` expired, with the attributes it was set with (src/server/lib/visitor.ts). */
export function expiredVisitorCookie(url: string): string {
  const {secure} = visitorCookieOptions(url);
  return `${VISITOR_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** The current request's execution context, when the runtime has one (in-process tests have none). */
function executionCtxOf(c: Context) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/** Mounted at `/site-api/account` (src/server/app.ts). */
export const accountRoutes = new Hono()
  // ─── Overview ─────────────────────────────────────────────────────────────
  .get('/overview', withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const db = c.var.db;
    const me = {id: c.var.viewer.id!, email: normEmail(c.var.viewer.email ?? '')};
    const [row, profile, addresses, recent, orderIds, wishlist, downloads, loc] = await Promise.all([
      db.user.findUnique({where: {id: me.id}, select: ACCOUNT_SELECT}),
      db.customerProfile.findUnique({where: {userId: me.id}, select: PROFILE_SELECT}),
      db.address.findMany({where: {userId: me.id}, orderBy: ADDRESS_ORDER, take: MAX_ADDRESSES, select: ADDRESS_SELECT}),
      db.shopOrder.findMany({
        where: ownedBy(me),
        orderBy: [{placedAt: 'desc'}, {id: 'desc'}],
        take: 3,
        include: OVERVIEW_ORDER_INCLUDE,
      }),
      // How many orders, capped at 100 (the menu shows "99+"), without count().
      db.shopOrder.findMany({where: ownedBy(me), select: {id: true}, take: 100}),
      wishlistIds(db, {userId: me.id}),
      db.shopOrderItem.findMany({
        where: {digital: true, download: {not: null}, order: {AND: [{payment: 'Paid'}, ownedBy(me)]}},
        select: {name: true, download: true, order: {select: {number: true}}},
        orderBy: [{order: {placedAt: 'desc'}}, {position: 'asc'}],
        take: 100,
      }),
      locOf(c),
    ]);
    if (!row) return signedOut(c);
    return c.json({
      user: serializeUser(row, profile, loc),
      addresses: addresses.map(serializeAddress),
      recentOrders: recent.map(o => serializeOrder(o, loc)),
      wishlistCount: wishlist.length,
      downloads: downloads.map(i => ({name: i.name, file: i.download!, orderNumber: i.order.number})),
      orderCount: orderIds.length,
    });
  })

  // ─── Profile and preferences ──────────────────────────────────────────────
  .patch('/profile', json(profileBody), withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const input = c.req.valid('json');
    const db = c.var.db;
    const id = c.var.viewer.id!;
    const locale = await profileLocale(c);
    const [row, profile] = await db.$transaction(async tx => {
      const p = await tx.customerProfile.upsert({
        where: {userId: id},
        create: {userId: id, firstName: input.firstName, lastName: input.lastName, phone: input.phone, locale},
        update: {firstName: input.firstName, lastName: input.lastName, phone: input.phone},
        select: PROFILE_SELECT,
      });
      // Keep the template's `users.name` (dashboard Users screen, account emails) in step. Only the name.
      const u = await tx.user.update({
        where: {id},
        data: {name: `${input.firstName} ${input.lastName}`.trim().slice(0, 80)},
        select: ACCOUNT_SELECT,
      });
      return [u, p] as const;
    });
    return c.json({user: serializeUser(row, profile, await locOf(c))});
  })

  .patch('/preferences', json(preferencesBody), withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const {newsletter} = c.req.valid('json');
    const db = c.var.db;
    const viewer = c.var.viewer;
    const id = viewer.id!;
    const email = normEmail(viewer.email ?? '');
    const locale = await profileLocale(c);
    await db.customerProfile.upsert({
      where: {userId: id},
      create: {userId: id, ...splitName(viewer.name ?? ''), marketingOptIn: newsletter, locale},
      update: {marketingOptIn: newsletter},
      select: {id: true},
    });
    // The subscriber list (admin → Subscribers) follows the account. Emails are stored lower-cased: exact match.
    if (newsletter) {
      await db.newsletterSubscriber.upsert({where: {email}, create: {email, source: 'account'}, update: {}, select: {id: true}});
    } else {
      await db.newsletterSubscriber.deleteMany({where: {email}});
    }
    const user = await accountUser(c, db, id);
    if (!user) return signedOut(c);
    return c.json({user});
  })

  // ─── Addresses ────────────────────────────────────────────────────────────
  .get('/addresses', withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const rows = await c.var.db.address.findMany({
      where: {userId: c.var.viewer.id!},
      orderBy: ADDRESS_ORDER,
      take: MAX_ADDRESSES,
      select: ADDRESS_SELECT,
    });
    return c.json(rows.map(serializeAddress));
  })

  .post('/addresses', json(addressBody), withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const input = c.req.valid('json');
    const userId = c.var.viewer.id!;
    const address = await c.var.db.$transaction(async tx => {
      const existing = await tx.address.findMany({where: {userId}, select: {id: true}, take: MAX_ADDRESSES});
      if (existing.length >= MAX_ADDRESSES) return null;
      const primary = input.primary === true || existing.length === 0;
      if (primary) await tx.address.updateMany({where: {userId, primary: true}, data: {primary: false}});
      return tx.address.create({
        data: {
          userId,
          label: input.label,
          name: input.name,
          line1: input.line1,
          line2: input.line2,
          city: input.city,
          zip: input.zip,
          country: input.country,
          phone: input.phone,
          primary,
        },
        select: ADDRESS_SELECT,
      });
    });
    if (!address) {
      return apiError(c, 409, 'address_limit', `You can save up to ${MAX_ADDRESSES} addresses. Remove one first`);
    }
    return c.json(serializeAddress(address), 201);
  })

  .patch('/addresses/:id', params(addressParam), json(addressPatch), withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const {id} = c.req.valid('param');
    const input = c.req.valid('json');
    const userId = c.var.viewer.id!;
    const db = c.var.db;
    const existing = await db.address.findFirst({where: {id, userId}, select: {id: true, primary: true}});
    if (!existing) return notFoundAddress(c);
    const address = await db.$transaction(async tx => {
      if (input.primary === true) {
        await tx.address.updateMany({where: {userId, primary: true, id: {not: id}}, data: {primary: false}});
      }
      // Field by field (no body spread). Keep one default: un-setting it on the default is ignored.
      const data: {[K in 'label' | 'name' | 'line1' | 'line2' | 'city' | 'zip' | 'country' | 'phone']?: string | null} & {
        primary?: boolean;
      } = {};
      for (const key of ['label', 'name', 'line1', 'line2', 'city', 'zip', 'country', 'phone'] as const) {
        const value = input[key];
        if (value !== undefined) (data as Record<string, string | null>)[key] = value;
      }
      if (input.primary === true) data.primary = true;
      else if (input.primary === false && !existing.primary) data.primary = false;
      return tx.address.update({where: {id: existing.id}, data: data as never, select: ADDRESS_SELECT});
    });
    return c.json(serializeAddress(address));
  })

  .delete('/addresses/:id', params(addressParam), withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const {id} = c.req.valid('param');
    const userId = c.var.viewer.id!;
    const db = c.var.db;
    const existing = await db.address.findFirst({where: {id, userId}, select: {id: true, primary: true}});
    if (!existing) return notFoundAddress(c);
    await db.$transaction(async tx => {
      await tx.address.delete({where: {id: existing.id}, select: {id: true}});
      if (existing.primary) {
        const next = await tx.address.findFirst({
          where: {userId},
          orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
          select: {id: true},
        });
        if (next) await tx.address.update({where: {id: next.id}, data: {primary: true}, select: {id: true}});
      }
    });
    return c.body(null, 204);
  })

  // ─── Data and privacy ─────────────────────────────────────────────────────
  .get('/export', withViewer, requireAuth, withDb, async c => {
    const db = c.var.db;
    const id = c.var.viewer.id!;
    await rateLimit(c, db, 'export', {userId: id});
    const [user, access] = await Promise.all([
      db.user.findUnique({where: {id}, select: {id: true, email: true, name: true, createdAt: true, updatedAt: true}}),
      getAccess(c.req.raw),
    ]);
    if (!user) return signedOut(c);
    const data = await exportUserData(db, user, access.roles);
    c.header('Content-Disposition', `attachment; filename="${exportFilename(user)}"`);
    c.header('Cache-Control', 'no-store');
    return c.json(data);
  })

  .post('/delete', json(deleteBody), withViewer, requireAuth, withDb, async c => {
    noStore(c);
    const {password, confirm} = c.req.valid('json');
    const db = c.var.db;
    const viewer = c.var.viewer;
    const me = {id: viewer.id!, email: normEmail(viewer.email ?? '')};

    // Staff and admins are closed by an admin (VAREL), before anything else.
    const {roles} = await getAccess(c.req.raw);
    if (roles.some(r => r !== 'member')) {
      return apiError(
        c,
        409,
        'staff_account',
        'Staff and admin accounts are closed by an admin. Ask an admin to change your role first'
      );
    }

    // Rows linked to the account by id (their email may be an older one): after the delete their userId is NULL.
    const [profile, settings, orders, reviews, redemptions] = await Promise.all([
      db.customerProfile.findUnique({where: {userId: me.id}, select: {firstName: true, locale: true}}),
      getSettings(db).catch(() => null),
      db.shopOrder.findMany({where: {userId: me.id}, select: {id: true}, take: LINKED_LIMIT}),
      db.review.findMany({where: {userId: me.id}, select: {id: true}, take: LINKED_LIMIT}),
      db.discountRedemption.findMany({where: {userId: me.id}, select: {id: true}, take: LINKED_LIMIT}),
    ]);

    // The template deletes the sign-in (password, the DELETE confirmation, the last-owner rule, its rate limit,
    // the session cookies): called in-process, never re-implemented. Its refusals pass through untouched.
    // Lazy (the app imports this module) and typed loosely, so the route types do not refer to themselves.
    const {app} = (await import('../app')) as unknown as {app: Pick<Hono, 'request'>};
    const headers = new Headers(c.req.raw.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    const res = await app.request(
      new URL('/site-api/auth/delete-account', c.req.url).toString(),
      {method: 'POST', headers, body: JSON.stringify({password, confirm})},
      c.env,
      executionCtxOf(c)
    );
    if (!res.ok) return res;

    const visitorId = readVisitorId(c) ?? undefined;
    try {
      const masked = maskEmail(me.email);
      const orderIds = orders.map(o => o.id);
      await db.$transaction([
        db.returnRequest.updateMany({where: {orderId: {in: orderIds}}, data: {email: masked}}),
        db.shopOrder.updateMany({where: {id: {in: orderIds}}, data: {email: masked, phone: null}}),
        db.discountRedemption.updateMany({where: {id: {in: redemptions.map(r => r.id)}}, data: {email: masked}}),
        db.review.updateMany({
          where: {id: {in: reviews.map(r => r.id)}},
          data: {name: DELETED_NAME, email: deletedEmail(me.id)},
        }),
      ]);
      await anonymiseCustomer(db, me, {visitorId});
    } catch {
      // No email in logs. The sign-in is already gone: still answer success.
      console.error('[account] anonymise failed', {userId: me.id});
    }

    // The goodbye note goes to the original address (sendTemplate never throws).
    await sendTemplate(
      db,
      'account_deleted',
      me.email,
      {
        firstName: profile?.firstName || splitName(viewer.name ?? '').firstName,
        storeName: settings?.storeName ?? 'VAREL',
        supportEmail: settings?.supportEmail ?? '',
      },
      {requestUrl: c.req.url, related: {type: 'user', id: String(me.id)}, locale: profile?.locale}
    );

    // The template's answer (with its cleared session cookies) plus the guest id cleared.
    const out = new Response(res.body, res);
    out.headers.append('set-cookie', expiredVisitorCookie(c.req.url));
    out.headers.set('Cache-Control', 'private, no-store');
    return out;
  });
