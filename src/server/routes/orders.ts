import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../generated/prisma/client';
import type {Order} from '../../lib/types/orders';
import {requireAuth, withDb, withViewer} from '../../platform/guards';
import type {Viewer} from '../../platform/types';
import {type Db, type EmailVars, refundOrder, restockOrder, sendTemplate} from '../lib/contracts';
import {HttpError} from '../lib/errors';
import {normEmail, plural} from '../lib/format';
import {cursorDate, decodeCursor, keysetPage, keysetWhere, orderByOf} from '../lib/http';
import {type Loc, locOf} from '../lib/i18n/localize';
import {fromCents, money} from '../lib/money';
import {canCancel, normalizeOrderNumber} from '../lib/orders';
import {type OrderRow, serializeOrder} from '../lib/serializers';
import {getSettings} from '../lib/settings';
import {json, params, query} from '../lib/validate';
import {variantMeta} from '../lib/variant-options';

/**
 * Orders (customer). WP-14 (docs/migration/PLAN.md §5), port of VAREL worker/routes/orders.ts (orders part):
 * VAREL `/api/<path>` is `/site-api/<path>` here, same shapes (src/lib/types/orders.ts), errors as
 * `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/orders                 CursorPage<Order> ?status=open|completed|returned&cursor=&pageSize= (signed in)
 *   GET    /site-api/orders/:number         Order: the owner, or anyone with ?email= (guest links, confirmation page)
 *   POST   /site-api/orders/:number/cancel  CancelOrderInput → Order
 *
 * Differences from VAREL: the history is a keyset page (≤ 50 per page) instead of the whole history; a guest
 * order counts as the signed-in customer's only when their email is VERIFIED (an unverified account could
 * otherwise claim someone's guest orders) and matches exactly (checkout stores emails lower-cased); an aged
 * access token answers `401 token_expired` (the browser refreshes and retries) instead of "not found".
 * The shared helpers below are also used by `returns.ts`.
 */

// ─── Shared helpers (also used by routes/returns.ts) ─────────────────────────

/** Every column `serializeOrder` reads plus what these routes need. Never the staff `note`, `billingAddress`,
    `releasedDiscounts` or `discountId`. */
export const ORDER_SELECT = {
  id: true,
  number: true,
  userId: true,
  email: true,
  phone: true,
  payment: true,
  fulfillment: true,
  stage: true,
  carrier: true,
  tracking: true,
  trackingUrl: true,
  method: true,
  address: true,
  billingSameAsShipping: true,
  cardBrand: true,
  cardLast4: true,
  subtotalCents: true,
  discountCode: true,
  discountCents: true,
  shippingCents: true,
  taxCents: true,
  totalCents: true,
  currency: true,
  locale: true,
  pricesIncludeTax: true,
  taxRate: true,
  customerNote: true,
  paymentProvider: true,
  placedAt: true,
  updatedAt: true,
  items: {
    orderBy: {position: 'asc'},
    select: {
      id: true,
      productId: true,
      name: true,
      category: true,
      sku: true,
      color: true,
      size: true,
      options: true,
      qty: true,
      priceCents: true,
      discountCents: true,
      digital: true,
      image: true,
      download: true,
    },
  },
  redemptions: {
    orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
    select: {
      discountId: true,
      label: true,
      code: true,
      freeShipping: true,
      amountCents: true,
      discount: {select: {method: true, name: true, label: true, kind: true}},
    },
  },
} satisfies Prisma.ShopOrderSelect;

/** A customer-facing order row (ORDER_SELECT). */
export type CustomerOrderRow = Prisma.ShopOrderGetPayload<{select: typeof ORDER_SELECT}>;

/** `serializeOrder` (F4) is typed on the full row but reads only ORDER_SELECT's columns. */
export const toOrder = (row: CustomerOrderRow, loc?: Loc): Order => serializeOrder(row as unknown as OrderRow, loc);

/** The longest order number the column holds (`shop_orders.number VarChar(20)`). */
const NUMBER_MAX = 20;

/** "24817" → "VRL-24817" with the store's CURRENT prefix (the module prefix of lib/orders is only current after
    getSettings ran in this isolate). `null` when the result cannot be an order number. */
export async function orderNumberOf(db: Db, raw: string): Promise<string | null> {
  const {orderPrefix} = await getSettings(db);
  const n = normalizeOrderNumber(raw, orderPrefix || undefined);
  return n && n.length <= NUMBER_MAX ? n : null;
}

/** One order by its number, with ORDER_SELECT. */
export async function findOrderByNumber(db: Db, number: string | null): Promise<CustomerOrderRow | null> {
  if (!number) return null;
  return db.shopOrder.findUnique({where: {number}, select: ORDER_SELECT});
}

/** The signed-in viewer's email, when it may claim guest orders (verified only). */
const claimEmail = (v: Viewer) => (v.state === 'user' && v.emailVerified && v.email ? normEmail(v.email) : null);

/** Orders that belong to a signed-in viewer: linked to the account, or a guest order with the account's verified
    email. Exact email match: checkout stores it lower-cased, and the `[email, placedAt]` index serves it. */
export function ownerWhere(v: Viewer): Prisma.ShopOrderWhereInput {
  const id = v.id ?? -1;
  const email = claimEmail(v);
  return email ? {OR: [{userId: id}, {userId: null, email}]} : {userId: id};
}

/** Is the viewer the order's owner (same rule as `ownerWhere`)? */
export function isOrderOwner(v: Viewer, o: {userId: number | null; email: string}): boolean {
  if (v.state !== 'user' || v.id == null) return false;
  if (o.userId === v.id) return true;
  const email = claimEmail(v);
  return !o.userId && !!email && normEmail(o.email) === email;
}

/** The owner, or anyone who knows the order's email (guest links). */
export function canSeeOrder(v: Viewer, o: {userId: number | null; email: string}, email?: string | null): boolean {
  return isOrderOwner(v, o) || (!!email && normEmail(email) === normEmail(o.email));
}

/** "mira@studio.dk" → "m***@studio.dk". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** An order for someone who only knows its number: no contact details, address, card, tracking or files. */
export function redactOrder(o: Order): Order {
  return {
    ...o,
    email: maskEmail(o.email),
    phone: null,
    address: null,
    billingSameAsShipping: true,
    cardBrand: null,
    cardLast4: null,
    tracking: null,
    trackingUrl: null,
    customerNote: null,
    discountCode: null,
    canCancel: false,
    items: o.items.map(i => ({...i, download: null})),
  };
}

/** The 401 that makes `siteFetch` refresh the session and retry. */
export const tokenExpired = () => new HttpError(401, 'token_expired', 'Your session needs refreshing.');

/** "$148", "€24.60", "DKK 148": whole amounts without decimals (VAREL email/triggers.ts). */
export function emailMoney(n: number, currency = 'USD'): string {
  const v = Math.round(n * 100) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

type AddressJson = {name?: string; line1?: string; line2?: string | null; city?: string; zip?: string; country?: string};
const firstWord = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';

/** Account order page for customers with an account, the confirmation page (with email) for guests. */
export const orderUrlOf = (origin: string, o: {number: string; email: string; userId: number | null}) =>
  o.userId
    ? `${origin}/account/orders/${encodeURIComponent(o.number)}/`
    : `${origin}/order/${encodeURIComponent(o.number)}/confirmation/?email=${encodeURIComponent(o.email)}`;

/** The shared order email variables (VAREL email/triggers.ts `orderVars`): firstName, orderNumber, orderUrl,
    items, subtotal, discount, shipping, tax, total, method, address, tracking. */
export function orderEmailVars(
  o: Pick<
    CustomerOrderRow,
    | 'number' | 'email' | 'userId' | 'currency' | 'address' | 'items' | 'subtotalCents' | 'discountCents'
    | 'shippingCents' | 'taxCents' | 'totalCents' | 'pricesIncludeTax' | 'method' | 'carrier' | 'tracking' | 'trackingUrl'
  >,
  origin: string,
  extra: {firstName?: string | null; returnWindowDays?: number} = {}
): EmailVars {
  const cur = o.currency || 'USD';
  const m = (cents: number) => emailMoney(fromCents(cents), cur);
  const addr = (o.address ?? null) as AddressJson | null;
  return {
    firstName: extra.firstName || firstWord(addr?.name),
    orderNumber: o.number,
    orderUrl: orderUrlOf(origin, o),
    items: o.items.map(i => ({
      name: i.name,
      meta: variantMeta(i),
      qty: i.qty,
      total: m(i.priceCents * i.qty - i.discountCents),
    })),
    subtotal: m(o.subtotalCents),
    discount: o.discountCents > 0 ? `−${m(o.discountCents)}` : '',
    shipping: o.shippingCents > 0 ? m(o.shippingCents) : 'Free',
    tax: o.taxCents > 0 ? m(o.taxCents) : '',
    ...(o.pricesIncludeTax ? {taxLabel: 'Includes tax'} : {}),
    total: m(o.totalCents),
    method: o.method,
    shippingAddress: addr?.line1
      ? [addr.name, addr.line1, addr.line2, [addr.zip, addr.city].filter(Boolean).join(' '), addr.country]
          .filter(Boolean)
          .join(', ')
      : '',
    carrier: o.carrier ?? '',
    trackingNumber: o.tracking ?? '',
    trackingUrl: o.trackingUrl ?? '',
    ...(extra.returnWindowDays != null ? {returnWindowDays: extra.returnWindowDays, returnsUrl: `${origin}/returns/`} : {}),
  };
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

/** Why the customer cancelled (optional); kept in the order timeline for the studio (English: staff text). */
export const CANCEL_REASONS = ['changed_mind', 'ordered_by_mistake', 'wrong_size', 'too_slow', 'other'] as const;
export type CancelReasonKey = (typeof CANCEL_REASONS)[number];
export const CANCEL_REASON_TEXT: Record<CancelReasonKey, string> = {
  changed_mind: 'Changed their mind',
  ordered_by_mistake: 'Ordered by mistake',
  wrong_size: 'Wrong size or colour',
  too_slow: 'Delivery takes too long',
  other: 'Other reason',
};

/** "Cancelled by the customer · Wrong size or colour · Refunded $148 · 2 items restocked". */
export function cancelEventText(input: {
  reason?: CancelReasonKey | null;
  paid: boolean;
  refundedCents: number;
  currency: string;
  units: number;
}): string {
  const parts = ['Cancelled by the customer'];
  if (input.reason) parts.push(CANCEL_REASON_TEXT[input.reason]);
  if (input.paid) parts.push(`Refunded ${money(fromCents(input.refundedCents), input.currency)}`);
  if (input.units) parts.push(`${plural(input.units, 'item')} restocked`);
  return parts.join(' · ');
}

const NOT_CANCELLABLE =
  'This order is already being packed, so it can no longer be cancelled. You can return it once it arrives';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const STATUS_FILTER: Record<string, Prisma.ShopOrderWhereInput> = {
  open: {fulfillment: {in: ['Unfulfilled', 'Processing', 'Shipped']}},
  completed: {fulfillment: 'Delivered'},
  returned: {fulfillment: 'Returned'},
};

/** Default and largest history page. */
export const ORDERS_PAGE = 20;
export const ORDERS_PAGE_MAX = 50;

const listQuery = z.object({
  status: z.enum(['open', 'completed', 'returned'], {error: 'Filter by open, completed or returned'}).optional(),
  cursor: z.string().trim().max(512).optional(),
  pageSize: z.coerce
    .number({error: 'Use a whole number'})
    .int('Use a whole number')
    .min(1, `Use 1 to ${ORDERS_PAGE_MAX}`)
    .max(ORDERS_PAGE_MAX, `Use 1 to ${ORDERS_PAGE_MAX}`)
    .optional(),
});

const numberParam = z.object({number: z.string().trim().min(1).max(24)});
const detailQuery = z.object({email: z.string().trim().max(254).optional()});
const cancelBody = z.object({
  email: z.string().trim().max(254).optional(),
  reason: z.enum(CANCEL_REASONS).optional(),
});

/** Same access rule for the detail and the cancel: owner, or the order's email. Throws 401 / 404. */
async function accessibleOrder(db: Db, viewer: Viewer, rawNumber: string, email: string | undefined) {
  if (viewer.state !== 'user' && !email) {
    if (viewer.state === 'returning') throw tokenExpired();
    throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
  }
  const order = await findOrderByNumber(db, await orderNumberOf(db, rawNumber));
  if (!order || !canSeeOrder(viewer, order, email)) {
    // An owner whose access token aged out must not get "not found": refresh and retry first.
    if (order && viewer.state === 'returning') throw tokenExpired();
    throw new HttpError(404, 'not_found', 'We cannot find that order');
  }
  return order;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** Mounted at `/site-api/orders` (src/server/app.ts). */
export const orderRoutes = new Hono()
  /* GET /orders — the signed-in customer's order history, newest first, one keyset page at a time. */
  .get('/', query(listQuery), withViewer, requireAuth, withDb, async c => {
    const q = c.req.valid('query');
    const size = q.pageSize ?? ORDERS_PAGE;
    const cur = decodeCursor(q.cursor);
    const at = cur ? cursorDate(cur[0]) : null;
    const after = at && typeof cur?.[1] === 'number' ? ([at, cur[1]] as const) : null;
    const rows = await c.var.db.shopOrder.findMany({
      where: {
        AND: [ownerWhere(c.var.viewer), q.status ? STATUS_FILTER[q.status]! : {}, keysetWhere('placedAt', 'desc', after)],
      },
      orderBy: orderByOf('placedAt', 'desc'),
      take: size + 1,
      select: ORDER_SELECT,
    });
    const loc = await locOf(c);
    const page = keysetPage(rows, size, r => [r.placedAt, r.id]);
    return c.json({items: page.items.map(r => toOrder(r, loc)), nextCursor: page.nextCursor});
  })

  /* GET /orders/:number — the owner, or a guest with ?email= (confirmation page, guest links). */
  // I2: rate limit (lookups by email).
  .get('/:number', params(numberParam), query(detailQuery), withViewer, withDb, async c => {
    const {number} = c.req.valid('param');
    const {email} = c.req.valid('query');
    const order = await accessibleOrder(c.var.db, c.var.viewer, number, email || undefined);
    return c.json(toOrder(order, await locOf(c)));
  })

  /* POST /orders/:number/cancel — the owner (or a guest with the order email) cancels before the order is packed.
     The order is claimed first so a concurrent "packed" move from the studio wins cleanly, then the payment is
     refunded in full (outside any transaction: the provider can be slow), then the pieces go back to stock. */
  .post('/:number/cancel', params(numberParam), json(cancelBody), withViewer, withDb, async c => {
    const {number} = c.req.valid('param');
    const input = c.req.valid('json');
    const db = c.var.db;
    const o = await accessibleOrder(db, c.var.viewer, number, input.email || undefined);
    if (o.fulfillment === 'Cancelled') throw new HttpError(409, 'already_cancelled', 'This order is already cancelled');
    if (!canCancel(o)) throw new HttpError(409, 'not_cancellable', NOT_CANCELLABLE);

    const claimed = await db.shopOrder.updateMany({
      where: {id: o.id, fulfillment: 'Unfulfilled', stage: {lte: 1}, payment: {in: ['Paid', 'Pending']}},
      data: {fulfillment: 'Cancelled'},
    });
    if (!claimed.count) throw new HttpError(409, 'not_cancellable', NOT_CANCELLABLE);

    const paid = o.payment === 'Paid';
    let refunded = 0;
    if (paid) {
      try {
        refunded = await refundOrder(
          db,
          {id: o.id, number: o.number, paymentProvider: o.paymentProvider, currency: o.currency},
          o.totalCents,
          'cancel'
        );
      } catch (e) {
        // The refund did not go through: put the order back so the studio still sees it, and let the customer retry.
        await db.shopOrder.updateMany({where: {id: o.id, fulfillment: 'Cancelled'}, data: {fulfillment: 'Unfulfilled'}});
        throw e;
      }
    }

    await db.$transaction(async tx => {
      if (paid) await tx.shopOrder.update({where: {id: o.id}, data: {payment: 'Refunded'}});
      const units = await restockOrder(tx, o.id);
      await tx.shopOrderEvent.create({
        data: {
          orderId: o.id,
          kind: 'status',
          message: cancelEventText({reason: input.reason, paid, refundedCents: refunded, currency: o.currency, units}),
          by: 'Customer',
        },
      });
    });

    if (refunded > 0) {
      const [settings, profile] = await Promise.all([
        getSettings(db),
        o.userId
          ? db.customerProfile.findUnique({where: {userId: o.userId}, select: {firstName: true}}).catch(() => null)
          : Promise.resolve(null),
      ]);
      await sendTemplate(
        db,
        'order_refunded',
        o.email,
        {
          ...orderEmailVars(o, new URL(c.req.url).origin, {
            firstName: profile?.firstName,
            returnWindowDays: settings.returnWindowDays,
          }),
          refundAmount: emailMoney(fromCents(refunded), o.currency || 'USD'),
        },
        {requestUrl: c.req.url, related: {type: 'order', id: o.number}, locale: o.locale}
      );
    }

    const fresh = await db.shopOrder.findUniqueOrThrow({where: {id: o.id}, select: ORDER_SELECT});
    return c.json(toOrder(fresh, await locOf(c)));
  });
