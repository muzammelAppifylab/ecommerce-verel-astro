import type {Context} from 'hono';
import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import type {AdminOrder, AdminOrderRow, AdminReturnRow, FulfillmentStatus, OrderEvent, PaymentStatus} from '../../../lib/types/admin/sales';
import {type CursorPage, PAGE_SIZE} from '../../../lib/types/common';
import {audit} from '../../../platform/auth';
import {requirePermission, withDb} from '../../../platform/guards';
import type {Viewer} from '../../../platform/types';
import {PERMISSIONS} from '../../permissions';
import {type Db, type EmailVars, refundOrder, sendTemplate} from '../../lib/contracts';
import {conflict, notFound} from '../../lib/errors';
import {displayDate, plural} from '../../lib/format';
import {
  type CursorValue,
  csvCell,
  cursorDate,
  decodeCursor,
  keysetPage,
  keysetWhere,
  orderByOf,
  parseSort,
  problemOf,
  sortProblem,
} from '../../lib/http';
import {fromCents, money, round2, toCents} from '../../lib/money';
import {lineRefund, normalizeOrderNumber} from '../../lib/orders';
import {asOrderAddress, type OrderRow, orderInclude, serializeOrder} from '../../lib/serializers';
import {getSettings} from '../../lib/settings';
import {variantMeta} from '../../lib/variant-options';
import {json, multiValue, pageQuery, query} from '../../lib/validate';

/**
 * Admin: Orders (port of VAREL worker/routes/admin/orders.ts, orders part; WP-19).
 * VAREL `/api/admin/orders…` is `/site-api/manage/orders…` here.
 *
 *   GET    /site-api/manage/orders                     CursorPage<AdminOrderRow> ?q&payment&fulfillment&from&to&sort&cursor&pageSize
 *   GET    /site-api/manage/orders/export.csv          CSV, same filters (VAREL /orders.csv), streamed, ≤ 4,000 rows
 *   GET    /site-api/manage/orders/:number             AdminOrder
 *   PATCH  /site-api/manage/orders/:number             AdminOrderUpdate → AdminOrder
 *   POST   /site-api/manage/orders/:number/refund      RefundInput → AdminOrder; 409 already_refunded / not_paid
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check
 * (orders) → activity log`; every handler adds its validator, `requirePermission(SHOP_ORDER_MANAGE)`
 * (defence in depth, memoized access read) and `withDb`. Every change appends a ShopOrderEvent.
 * Money on the wire is in currency units (`fromCents`), ids are strings. The admin works in the
 * SOURCE language: nothing here is localized.
 *
 * The serializers and helpers below are shared with `./returns.ts` (one VAREL file).
 */

type Env = {Variables: {viewer: Viewer}};

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAYMENTS = ['Paid', 'Pending', 'Refunded', 'Failed'] as const;
export const FULFILLMENTS = ['Unfulfilled', 'Processing', 'Shipped', 'Delivered', 'Returned', 'Cancelled'] as const;
/** Staff move orders between these; only the customer cancels (POST /orders/:number/cancel, WP-14), which also refunds. */
export const MOVES = ['Unfulfilled', 'Processing', 'Shipped', 'Delivered', 'Returned'] as const;

/** Stage follows fulfillment when not given. */
export const STAGE_FOR: Record<FulfillmentStatus, 1 | 2 | 3 | 4> = {
  Unfulfilled: 1,
  Processing: 2,
  Shipped: 3,
  Delivered: 4,
  Returned: 4,
  Cancelled: 1,
};

/** Column sizes of shop_order_events (F1). */
export const EVENT_MESSAGE_MAX = 2000;
export const EVENT_BY_MAX = 120;
/** At most this many words of `q` are searched (each word adds an OR group and one bounded raw query). */
export const SEARCH_WORDS_MAX = 5;
/** CSV export: keyset pages of 100 rows, at most 40 of them (4,000 orders). */
export const CSV_PAGE = 100;
export const CSV_MAX_PAGES = 40;

export const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** The acting staff member's name for events (VAREL `staffName`). */
export function actorName(viewer: Pick<Viewer, 'name' | 'email'> | undefined): string {
  return clip(viewer?.name?.trim() || viewer?.email || 'Staff', EVENT_BY_MAX);
}

export const searchWords = (q: string | undefined) => (q ?? '').split(/\s+/).filter(Boolean).slice(0, SEARCH_WORDS_MAX);

/** 422 for a sort outside the whitelist. */
export const badSort = (allowed: readonly string[]) => problemOf('invalid_input', 'Check the highlighted fields', sortProblem(allowed));

// ─── Shared serializers (orders and returns) ─────────────────────────────────

type ProfileName = {firstName: string; lastName: string} | null;
type UserName = {name: string; customerProfile: ProfileName} | null;

const addressName = (json: Prisma.JsonValue | null): string | null => {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const n = (json as Record<string, unknown>).name;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return null;
};

/** Profile first + last name → account name → shipping-address name → email. */
export function customerNameOf(o: {address: Prisma.JsonValue | null; email: string; user: UserName}): string {
  const profile = o.user?.customerProfile;
  const full = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
  return full || o.user?.name?.trim() || addressName(o.address) || o.email;
}

export const orderRowSelect = {
  id: true,
  number: true,
  placedAt: true,
  email: true,
  userId: true,
  payment: true,
  fulfillment: true,
  totalCents: true,
  currency: true,
  address: true,
  user: {select: {name: true, customerProfile: {select: {firstName: true, lastName: true}}}},
  items: {select: {qty: true}, take: 100},
} satisfies Prisma.ShopOrderSelect;

export type OrderRowRow = Prisma.ShopOrderGetPayload<{select: typeof orderRowSelect}>;

export function adminOrderRow(o: OrderRowRow): AdminOrderRow {
  return {
    number: o.number,
    placedAt: o.placedAt.toISOString(),
    date: displayDate(o.placedAt),
    customerName: customerNameOf(o),
    email: o.email,
    customerId: o.userId == null ? null : String(o.userId),
    payment: o.payment as PaymentStatus,
    fulfillment: o.fulfillment as FulfillmentStatus,
    total: fromCents(o.totalCents),
    count: o.items.reduce((n, i) => n + i.qty, 0),
    currency: o.currency,
  };
}

export interface ReturnItemJson {
  lineId: number;
  qty: number;
  reason: string;
}

/** Return items JSON (`[{lineId, qty, reason}]`): numeric or digit-string line ids; bad entries dropped, qty ≥ 0. */
export function returnItems(json: Prisma.JsonValue | null | undefined): ReturnItemJson[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap(x => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const raw = typeof o.lineId === 'string' && /^\d{1,10}$/.test(o.lineId.trim()) ? Number(o.lineId) : o.lineId;
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) return [];
    const qty = Math.floor(Number(o.qty ?? 0));
    return [{lineId: raw, qty: Number.isFinite(qty) ? Math.max(0, qty) : 0, reason: String(o.reason ?? '')}];
  });
}

/** The money columns of an order (cents), converted for `lineRefund` / `shippingRefund` (currency units). */
export interface OrderMoneyCents {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  pricesIncludeTax: boolean;
  taxRate: {toString(): string} | number | string | null;
}
export const orderMoney = (o: OrderMoneyCents) => ({
  subtotal: fromCents(o.subtotalCents),
  discount: fromCents(o.discountCents),
  tax: fromCents(o.taxCents),
  pricesIncludeTax: o.pricesIncludeTax,
  taxRate: o.taxRate == null ? null : Number(o.taxRate.toString()),
});
export interface LineMoneyCents {
  id: number;
  priceCents: number;
  qty: number;
  discountCents: number;
}
export const lineMoney = (l: LineMoneyCents) => ({price: fromCents(l.priceCents), qty: l.qty, discount: fromCents(l.discountCents)});

/** What giving back `items` is worth (currency units): each line after its allocated discount, plus its tax share on exclusive orders. */
export function returnAmount(order: OrderMoneyCents & {items: LineMoneyCents[]}, items: ReturnItemJson[]): number {
  const m = orderMoney(order);
  const amount = items.reduce((n, it) => {
    const line = order.items.find(l => l.id === it.lineId);
    return n + (line ? lineRefund(m, lineMoney(line), it.qty) : 0);
  }, 0);
  return round2(amount);
}

export function adminReturnRow(
  r: {id: number; email: string; status: string; createdAt: Date; items: Prisma.JsonValue},
  order: {number: string; items: LineMoneyCents[]} & OrderMoneyCents
): AdminReturnRow {
  const items = returnItems(r.items);
  return {
    id: String(r.id),
    orderNumber: order.number,
    email: r.email,
    status: r.status as AdminReturnRow['status'],
    createdAt: r.createdAt.toISOString(),
    itemCount: items.reduce((n, it) => n + it.qty, 0),
    amount: returnAmount(order, items),
  };
}

/** Units of each order line already back through REFUNDED returns (rows without `status` count as refunded). */
export function unitsBack(returns: {status?: string; items: Prisma.JsonValue}[]): Map<number, number> {
  const back = new Map<number, number>();
  for (const r of returns) {
    if (r.status !== undefined && r.status !== 'Refunded') continue;
    for (const it of returnItems(r.items)) back.set(it.lineId, (back.get(it.lineId) ?? 0) + it.qty);
  }
  return back;
}

export interface RefundLine extends LineMoneyCents {
  sku: string;
  digital: boolean;
}

/** What a full refund still covers once returns that were already refunded are taken out (amount in currency units). */
export function refundableOf(
  o: OrderMoneyCents & {totalCents: number; items: RefundLine[]},
  refundedReturns: {status?: string; items: Prisma.JsonValue}[]
) {
  const back = unitsBack(refundedReturns);
  const m = orderMoney(o);
  // What refunded returns already paid back: lines after their allocated discount, plus their share of tax.
  const returnedValue = o.items.reduce((n, l) => n + lineRefund(m, lineMoney(l), Math.min(l.qty, back.get(l.id) ?? 0)), 0);
  return {
    amount: Math.max(0, Math.round((fromCents(o.totalCents) - returnedValue) * 100) / 100),
    remaining: o.items.map(l => ({sku: l.sku, digital: l.digital, qty: Math.max(0, l.qty - (back.get(l.id) ?? 0))})),
  };
}

/** Return item quantities to stock (physical lines whose variant still exists and tracks inventory). */
export async function restockLines(tx: Db, lines: {sku: string; qty: number; digital: boolean}[]): Promise<number> {
  let units = 0;
  for (const l of lines) {
    if (l.digital || l.qty <= 0) continue;
    const r = await tx.variant.updateMany({where: {id: l.sku, inventory: {not: null}}, data: {inventory: {increment: l.qty}}});
    if (r.count) units += l.qty;
  }
  return units;
}

// ─── Order emails (VAREL lib/email/triggers.ts) ──────────────────────────────

/** "$148", "€24.60", "DKK 148" — whole amounts without decimals. */
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

const firstWord = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';

const emailOrderSelect = {
  id: true,
  number: true,
  email: true,
  userId: true,
  locale: true,
  currency: true,
  address: true,
  method: true,
  carrier: true,
  tracking: true,
  trackingUrl: true,
  subtotalCents: true,
  discountCents: true,
  shippingCents: true,
  taxCents: true,
  totalCents: true,
  pricesIncludeTax: true,
  user: {select: {customerProfile: {select: {firstName: true}}}},
  items: {
    select: {id: true, name: true, color: true, size: true, options: true, qty: true, priceCents: true, discountCents: true},
    orderBy: {position: 'asc'},
    take: 100,
  },
} satisfies Prisma.ShopOrderSelect;

export type EmailOrder = Prisma.ShopOrderGetPayload<{select: typeof emailOrderSelect}>;

/** Account order page for customers with an account, the confirmation page (with email) for guests. */
export const orderUrlOf = (origin: string, o: {number: string; email: string; userId: number | null}) =>
  o.userId
    ? `${origin}/account/orders/${encodeURIComponent(o.number)}/`
    : `${origin}/order/${encodeURIComponent(o.number)}/confirmation/?email=${encodeURIComponent(o.email)}`;

/** The shared order variables (VAREL docs/EMAIL.md): firstName, orderNumber, orderUrl, items, subtotal, discount, … */
export function orderEmailVars(o: EmailOrder, origin: string): EmailVars {
  const cur = o.currency || 'USD';
  const m = (v: number) => emailMoney(v, cur);
  const addr = asOrderAddress(o.address);
  return {
    firstName: o.user?.customerProfile?.firstName || firstWord(addr?.name),
    orderNumber: o.number,
    orderUrl: orderUrlOf(origin, o),
    items: o.items.map(i => ({
      name: i.name,
      meta: variantMeta(i),
      qty: i.qty,
      total: m(fromCents(i.priceCents * i.qty - i.discountCents)),
    })),
    subtotal: m(fromCents(o.subtotalCents)),
    discount: o.discountCents > 0 ? `−${m(fromCents(o.discountCents))}` : '',
    shipping: o.shippingCents > 0 ? m(fromCents(o.shippingCents)) : 'Free',
    tax: o.taxCents > 0 ? m(fromCents(o.taxCents)) : '',
    ...(o.pricesIncludeTax ? {taxLabel: 'Includes tax'} : {}),
    total: m(fromCents(o.totalCents)),
    method: o.method,
    shippingAddress: addr?.line1
      ? [addr.name, addr.line1, addr.line2, [addr.zip, addr.city].filter(Boolean).join(' '), addr.country].filter(Boolean).join(', ')
      : '',
    carrier: o.carrier ?? '',
    trackingNumber: o.tracking ?? '',
    trackingUrl: o.trackingUrl ?? '',
  };
}

const originOf = (c: Context) => new URL(c.req.url).origin;

/** order_shipped, order_delivered, order_refunded (after commit). `refundAmountCents` for order_refunded (default: the total). Never throws. */
export async function sendOrderEmail(
  c: Context,
  db: Db,
  orderId: number,
  key: 'order_shipped' | 'order_delivered' | 'order_refunded',
  extra: {refundAmountCents?: number} = {}
): Promise<void> {
  try {
    const o = await db.shopOrder.findUnique({where: {id: orderId}, select: emailOrderSelect});
    if (!o) return;
    const s = await getSettings(db);
    const origin = originOf(c);
    const vars: EmailVars = {...orderEmailVars(o, origin), returnWindowDays: s.returnWindowDays, returnsUrl: `${origin}/returns/`};
    if (key === 'order_refunded') vars.refundAmount = emailMoney(fromCents(extra.refundAmountCents ?? o.totalCents), o.currency || 'USD');
    await sendTemplate(db, key, o.email, vars, {requestUrl: c.req.url, related: {type: 'order', id: o.number}, locale: o.locale});
  } catch (e) {
    console.error(`[email] ${key} for order ${orderId} failed`, (e as Error).message);
  }
}

/** return_update after a return changes status (after commit). `refundAmountCents` for refunded returns. Never throws. */
export async function sendReturnUpdate(c: Context, db: Db, returnId: number, opts: {refundAmountCents?: number} = {}): Promise<void> {
  try {
    const r = await db.returnRequest.findUnique({
      where: {id: returnId},
      select: {id: true, orderId: true, email: true, status: true, items: true, note: true},
    });
    if (!r) return;
    const o = await db.shopOrder.findUnique({where: {id: r.orderId}, select: emailOrderSelect});
    if (!o) return;
    const cur = o.currency || 'USD';
    const items = returnItems(r.items).flatMap(it => {
      const line = o.items.find(l => l.id === it.lineId);
      return line ? [{name: line.name, meta: variantMeta(line), qty: it.qty || line.qty, total: ''}] : [];
    });
    const status = r.status;
    const label = status === 'Rejected' ? 'declined' : status === 'Requested' ? 'reopened' : status.toLowerCase();
    await sendTemplate(
      db,
      'return_update',
      r.email || o.email,
      {
        ...orderEmailVars(o, originOf(c)),
        items,
        returnStatus: label,
        approved: status === 'Approved',
        received: status === 'Received',
        refunded: status === 'Refunded',
        rejected: status === 'Rejected',
        requested: status === 'Requested',
        refundAmount: opts.refundAmountCents != null ? emailMoney(fromCents(opts.refundAmountCents), cur) : '',
        note: r.note ?? '',
      },
      {requestUrl: c.req.url, related: {type: 'return', id: String(r.id)}, locale: o.locale}
    );
  } catch (e) {
    console.error(`[email] return_update for ${returnId} failed`, (e as Error).message);
  }
}

// ─── List / CSV ───────────────────────────────────────────────────────────────

export const ORDER_SORT_FIELDS = ['placedAt', 'number', 'total', 'email'] as const;
type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];
/** Sort key → column. */
const SORT_COLUMN: Record<OrderSortField, 'placedAt' | 'number' | 'totalCents' | 'email'> = {
  placedAt: 'placedAt',
  number: 'number',
  total: 'totalCents',
  email: 'email',
};

/** Comma-separated (or repeated) list restricted to `values` (VAREL `multiOf`). */
export const multiOf = <const V extends readonly [string, ...string[]]>(values: V) =>
  multiValue().pipe(z.array(z.enum(values, {error: `Use ${values.join(', ')}`})));

/** `?from=` / `?to=` (YYYY-MM-DD or ISO). `to` given as a bare date is inclusive (end of that day). */
export const dateParam = z
  .string()
  .trim()
  .max(40, 'Use a date such as 2026-10-01')
  .optional()
  .transform((s, ctx) => {
    if (!s) return undefined;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({code: 'custom', message: 'Use a date such as 2026-10-01'});
      return z.NEVER;
    }
    return {date: d, bare: /^\d{4}-\d{2}-\d{2}$/.test(s)};
  });

export const ordersListQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  sort: z.string().trim().max(40).optional(),
  payment: multiOf(PAYMENTS),
  fulfillment: multiOf(FULFILLMENTS),
  from: dateParam,
  to: dateParam,
  ...pageQuery,
});
export type OrdersListQuery = z.output<typeof ordersListQuery>;

/** Orders whose shipping-address name contains a word (case-insensitive; Prisma JSON filters are case-sensitive). Bounded. */
async function idsByAddressName(db: Db, word: string): Promise<number[]> {
  const like = `%${word.replace(/[\\%_]/g, m => '\\' + m)}%`;
  const rows = await db.$queryRaw<{id: number}[]>`
    SELECT "id" FROM "shop_orders" WHERE "address"->>'name' ILIKE ${like} ORDER BY "placed_at" DESC LIMIT 500`;
  return rows.map(r => Number(r.id));
}

export async function orderWhere(db: Db, q: OrdersListQuery): Promise<Prisma.ShopOrderWhereInput> {
  const words = searchWords(q.q);
  const digits = words.some(w => /^\d+$/.test(w));
  // getSettings refreshes the order prefix normalizeOrderNumber uses (read only for all-digit words).
  const [byName] = await Promise.all([Promise.all(words.map(w => idsByAddressName(db, w))), digits ? getSettings(db) : null]);
  const to = q.to ? (q.to.bare ? new Date(q.to.date.getTime() + 86_400_000) : q.to.date) : undefined;
  const contains = (w: string) => ({contains: w, mode: 'insensitive' as const});
  return {
    ...(q.payment.length ? {payment: {in: q.payment}} : {}),
    ...(q.fulfillment.length ? {fulfillment: {in: q.fulfillment}} : {}),
    ...(q.from || to ? {placedAt: {...(q.from ? {gte: q.from.date} : {}), ...(to ? {lt: to} : {})}} : {}),
    ...(words.length
      ? {
          AND: words.map((w, i) => ({
            OR: [
              {number: contains(w)},
              {email: contains(w)},
              {user: {name: contains(w)}},
              {user: {customerProfile: {firstName: contains(w)}}},
              {user: {customerProfile: {lastName: contains(w)}}},
              ...(byName[i]!.length ? [{id: {in: byName[i]!}}] : []),
              ...(/^\d+$/.test(w) ? [{number: normalizeOrderNumber(w)}] : []),
            ],
          })),
        }
      : {}),
  };
}

/** The keyset filter after a cursor, or `{}` (a malformed cursor starts from the top). */
function afterCursor(field: OrderSortField, dir: 'asc' | 'desc', cursor: string | undefined): Prisma.ShopOrderWhereInput {
  const after = decodeCursor(cursor);
  if (!after) return {};
  const [value, id] = after;
  if (typeof id !== 'number') return {};
  let v: unknown;
  if (field === 'placedAt') v = cursorDate(value);
  else if (field === 'total') v = typeof value === 'number' ? value : null;
  else v = typeof value === 'string' ? value : null;
  if (v === null) return {};
  return keysetWhere(SORT_COLUMN[field], dir, [v, id]) as Prisma.ShopOrderWhereInput;
}

type CursorRow = {id: number; placedAt: Date; number: string; totalCents: number; email: string};
const cursorOf =
  (field: OrderSortField) =>
  (o: CursorRow): CursorValue[] => {
    const value = field === 'placedAt' ? o.placedAt.toISOString() : field === 'total' ? o.totalCents : field === 'number' ? o.number : o.email;
    return [value, o.id];
  };

const csvSelect = {
  ...orderRowSelect,
  subtotalCents: true,
  discountCode: true,
  discountCents: true,
  shippingCents: true,
  taxCents: true,
  method: true,
  carrier: true,
  tracking: true,
} satisfies Prisma.ShopOrderSelect;

export type CsvOrder = Prisma.ShopOrderGetPayload<{select: typeof csvSelect}>;

export const ORDERS_CSV_HEADER = [
  'Order',
  'Placed',
  'Customer',
  'Email',
  'Payment',
  'Fulfillment',
  'Items',
  'Subtotal',
  'Discount code',
  'Discount',
  'Shipping',
  'Tax',
  'Total',
  'Country',
  'Method',
  'Carrier',
  'Tracking',
];

const cents2 = (c: number) => (c / 100).toFixed(2);

/** One CSV line (no line break); every cell formula-escaped by `csvCell`. */
export function orderCsvRow(o: CsvOrder): string {
  return [
    o.number,
    o.placedAt,
    customerNameOf(o),
    o.email,
    o.payment,
    o.fulfillment,
    o.items.reduce((n, i) => n + i.qty, 0),
    cents2(o.subtotalCents),
    o.discountCode,
    cents2(o.discountCents),
    cents2(o.shippingCents),
    cents2(o.taxCents),
    cents2(o.totalCents),
    asOrderAddress(o.address)?.country ?? '',
    o.method,
    o.carrier,
    o.tracking,
  ]
    .map(csvCell)
    .join(',');
}

// ─── Detail ───────────────────────────────────────────────────────────────────

/** Every order column `serializeOrder` reads, plus what the admin adds. Relations bounded. */
const adminOrderSelect = {
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
  note: true,
  placedAt: true,
  items: {
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
      position: true,
    },
    orderBy: {position: 'asc'},
    take: 100,
  },
  redemptions: {...orderInclude.redemptions, take: 20},
  user: {select: {id: true, email: true, name: true, customerProfile: {select: {firstName: true, lastName: true}}}},
  events: {select: {at: true, kind: true, message: true, by: true}, orderBy: [{at: 'desc'}, {id: 'desc'}], take: 100},
  returns: {select: {id: true, email: true, status: true, createdAt: true, items: true}, orderBy: {createdAt: 'desc'}, take: 50},
} satisfies Prisma.ShopOrderSelect;

export type AdminOrderFull = Prisma.ShopOrderGetPayload<{select: typeof adminOrderSelect}>;

export function adminOrder(o: AdminOrderFull): AdminOrder {
  const profile = o.user?.customerProfile;
  return {
    // The select holds every column serializeOrder reads (its parameter is typed on the whole row).
    ...serializeOrder(o as unknown as OrderRow),
    customer: o.user
      ? {
          id: String(o.user.id),
          name: (profile ? `${profile.firstName} ${profile.lastName}`.trim() : '') || o.user.name || o.user.email,
          email: o.user.email,
        }
      : null,
    note: o.note,
    events: o.events.map(e => ({at: e.at.toISOString(), kind: e.kind as OrderEvent['kind'], message: e.message, by: e.by})),
    returns: o.returns.map(r => adminReturnRow(r, o)),
  };
}

/** `:number` as typed ("24817", "vrl24817", " VRL-24817 ") → the stored number, or null when it cannot be one. */
export async function orderNumberOf(db: Db, param: string): Promise<string | null> {
  const raw = param.trim();
  if (!raw || raw.length > 40) return null;
  if (/^\d+$/.test(raw.replace(/\s+/g, ''))) await getSettings(db); // refreshes the order prefix
  return normalizeOrderNumber(raw);
}

export async function loadAdminOrder(db: Db, number: string): Promise<AdminOrderFull> {
  const n = await orderNumberOf(db, number);
  const o = n ? await db.shopOrder.findUnique({where: {number: n}, select: adminOrderSelect}) : null;
  if (!o) throw notFound('We cannot find that order');
  return o;
}

// ─── Update / refund ──────────────────────────────────────────────────────────

export const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .nullable()
    .transform(v => (v ? v : null));

export const orderUpdateBody = z.object({
  fulfillment: z.enum(MOVES, {error: 'Choose a fulfillment status'}).optional(),
  stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)], {error: 'Use a stage from 1 to 4'}).optional(),
  carrier: nullableText(80).optional(),
  tracking: nullableText(120).optional(),
  trackingUrl: z
    .string()
    .trim()
    .max(500, 'Keep this under 500 characters')
    .refine(s => !s || /^https?:\/\//i.test(s), 'Use a full URL starting with https://')
    .nullable()
    .transform(v => (v ? v : null))
    .optional(),
  payment: z.enum(PAYMENTS, {error: 'Choose a payment status'}).optional(),
  note: nullableText(2000).optional(),
});
export type OrderUpdateInput = z.output<typeof orderUpdateBody>;

export type EventIn = {kind: OrderEvent['kind']; message: string};

type UpdatableOrder = {
  fulfillment: string;
  stage: number;
  payment: string;
  carrier: string | null;
  tracking: string | null;
  trackingUrl: string | null;
  note: string | null;
};

/** What a PATCH changes and the timeline events it writes (VAREL l.181–233). Throws 409 for closed orders. */
export function orderUpdatePlan(o: UpdatableOrder, input: OrderUpdateInput) {
  const data: Prisma.ShopOrderUpdateInput = {};
  const events: EventIn[] = [];

  const carrier = input.carrier !== undefined ? input.carrier : o.carrier;
  const tracking = input.tracking !== undefined ? input.tracking : o.tracking;
  const trackingChanged =
    (input.carrier !== undefined && input.carrier !== o.carrier) ||
    (input.tracking !== undefined && input.tracking !== o.tracking) ||
    (input.trackingUrl !== undefined && input.trackingUrl !== o.trackingUrl);
  const trackingText = [carrier, tracking].filter(Boolean).join(' ');

  if (input.fulfillment && input.fulfillment !== o.fulfillment) {
    if (o.fulfillment === 'Cancelled') {
      throw conflict('ORDER_CANCELLED', 'The customer cancelled this order, so its fulfilment can no longer change');
    }
    if (o.payment === 'Refunded') {
      throw conflict('ORDER_REFUNDED', 'This order has been refunded, so its fulfilment can no longer change');
    }
    data.fulfillment = input.fulfillment;
    data.stage = input.stage ?? STAGE_FOR[input.fulfillment];
    let message = `Marked as ${input.fulfillment.toLowerCase()}`;
    if (input.fulfillment === 'Shipped' && trackingText) message += ` · ${trackingText}`;
    events.push({kind: 'status', message});
  } else if (input.stage && input.stage !== o.stage) {
    data.stage = input.stage;
    events.push({kind: 'status', message: `Progress set to step ${input.stage} of 4`});
  }

  if (trackingChanged) {
    if (input.carrier !== undefined) data.carrier = input.carrier;
    if (input.tracking !== undefined) data.tracking = input.tracking;
    if (input.trackingUrl !== undefined) data.trackingUrl = input.trackingUrl;
    const alreadySaid = events.some(e => e.message.includes('Marked as shipped ·'));
    if (!alreadySaid) events.push({kind: 'tracking', message: trackingText ? `Tracking updated · ${trackingText}` : 'Tracking removed'});
  }

  if (input.payment && input.payment !== o.payment) {
    data.payment = input.payment;
    events.push({kind: input.payment === 'Refunded' ? 'refund' : 'status', message: `Payment marked as ${input.payment.toLowerCase()}`});
  }

  if (input.note !== undefined && input.note !== o.note) {
    data.note = input.note;
    events.push({
      kind: 'note',
      message: input.note ? `Note · ${input.note.length > 140 ? input.note.slice(0, 139) + '…' : input.note}` : 'Note cleared',
    });
  }

  return {data, events: events.map(e => ({...e, message: clip(e.message, EVENT_MESSAGE_MAX)}))};
}

export const refundBody = z.object({
  restock: z.boolean({error: 'Choose whether to restock'}),
  note: nullableText(500).optional(),
});

/** The refund event text. It MUST start with "Refunded <amount>" (the activity log reads it). */
export function refundMessage(refundedCents: number, currency: string, restock: boolean, units: number, note?: string | null): string {
  const parts = [`Refunded ${money(fromCents(refundedCents), currency)}`];
  if (restock) parts.push(units ? `${plural(units, 'item')} restocked` : 'nothing to restock');
  if (note) parts.push(note);
  return clip(parts.join(' · '), EVENT_MESSAGE_MAX);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const guard = requirePermission(PERMISSIONS.SHOP_ORDER_MANAGE);

export const ordersAdmin = new Hono<Env>()
  .get('/', query(ordersListQuery), guard, withDb, async c => {
    const q = c.req.valid('query');
    const sort = parseSort(q.sort, ORDER_SORT_FIELDS, '-placedAt');
    if (!sort) return c.json(badSort(ORDER_SORT_FIELDS), 422);
    const size = q.pageSize ?? PAGE_SIZE;
    const db = c.var.db;
    const where = await orderWhere(db, q);
    const rows = await db.shopOrder.findMany({
      where: {AND: [where, afterCursor(sort.field, sort.dir, q.cursor)]},
      select: orderRowSelect,
      orderBy: orderByOf(SORT_COLUMN[sort.field], sort.dir) as Prisma.ShopOrderOrderByWithRelationInput[],
      take: size + 1,
    });
    const page = keysetPage(rows, size, cursorOf(sort.field));
    c.header('Cache-Control', 'private, no-store');
    return c.json({items: page.items.map(adminOrderRow), nextCursor: page.nextCursor} satisfies CursorPage<AdminOrderRow>);
  })

  .get('/export.csv', query(ordersListQuery), guard, withDb, async c => {
    const q = c.req.valid('query');
    const sort = parseSort(q.sort, ORDER_SORT_FIELDS, '-placedAt');
    if (!sort) return c.json(badSort(ORDER_SORT_FIELDS), 422);
    const db = c.var.db;
    const where = await orderWhere(db, q);
    const filtered = Boolean(q.q || q.payment.length || q.fulfillment.length || q.from || q.to);
    // A personal-data export: who exported, and whether it was filtered.
    await audit(db, {actorUserId: c.var.viewer.id, action: 'orders_exported', target: ['shop_order', 'export'], meta: {filtered}});

    const column = SORT_COLUMN[sort.field];
    const orderBy = orderByOf(column, sort.dir) as Prisma.ShopOrderOrderByWithRelationInput[];
    const toCursor = cursorOf(sort.field);
    const encoder = new TextEncoder();
    let after: Prisma.ShopOrderWhereInput = {};
    let pages = 0;
    // One keyset page of 100 per pull, so memory stays small and the export stops at 4,000 rows.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(ORDERS_CSV_HEADER.map(csvCell).join(',') + '\r\n'));
      },
      async pull(controller) {
        try {
          const rows = await db.shopOrder.findMany({where: {AND: [where, after]}, select: csvSelect, orderBy, take: CSV_PAGE});
          pages++;
          if (rows.length) controller.enqueue(encoder.encode(rows.map(orderCsvRow).join('\r\n') + '\r\n'));
          if (rows.length < CSV_PAGE || pages >= CSV_MAX_PAGES) return controller.close();
          const [value, id] = toCursor(rows.at(-1)!);
          after = keysetWhere(column, sort.dir, [sort.field === 'placedAt' ? new Date(value as string) : value, id]) as Prisma.ShopOrderWhereInput;
        } catch (e) {
          console.error('[orders] CSV export failed', (e as Error).message);
          controller.error(e);
        }
      },
    });
    const today = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="varel-orders-${today}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  })

  .get('/:number', guard, withDb, async c => {
    const o = await loadAdminOrder(c.var.db, c.req.param('number'));
    c.header('Cache-Control', 'private, no-store');
    return c.json(adminOrder(o));
  })

  .patch('/:number', json(orderUpdateBody), guard, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const o = await loadAdminOrder(db, c.req.param('number'));
    const by = actorName(c.var.viewer);
    const {data, events} = orderUpdatePlan(o, input);

    if (events.length) {
      const now = Date.now();
      await db.$transaction([
        db.shopOrder.update({where: {id: o.id}, data, select: {id: true}}),
        db.shopOrderEvent.createMany({data: events.map((e, i) => ({...e, orderId: o.id, by, at: new Date(now + i)}))}),
      ]);
    }
    if (data.fulfillment === 'Shipped' || data.fulfillment === 'Delivered') {
      await sendOrderEmail(c, db, o.id, data.fulfillment === 'Shipped' ? 'order_shipped' : 'order_delivered');
    }
    c.header('Cache-Control', 'private, no-store');
    return c.json(adminOrder(events.length ? await loadAdminOrder(db, o.number) : o));
  })

  .post('/:number/refund', json(refundBody), guard, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const o = await loadAdminOrder(db, c.req.param('number'));
    if (o.payment === 'Refunded') throw conflict('ALREADY_REFUNDED', 'This order has already been refunded');
    if (o.payment !== 'Paid') throw conflict('NOT_PAID', `Only paid orders can be refunded. This order's payment is ${o.payment.toLowerCase()}`);
    const by = actorName(c.var.viewer);
    // Lines already refunded through returns were restocked and paid back then: refund and restock only the rest.
    const {amount, remaining} = refundableOf(o, o.returns.filter(r => r.status === 'Refunded'));
    // Money first, outside any transaction: a provider error (502 payment_provider_error) leaves the order as it was.
    // The reason key makes a retry after a failed write safe (WP-11 refunds once per key).
    const refundedCents = await refundOrder(
      db,
      {id: o.id, number: o.number, paymentProvider: o.paymentProvider, currency: o.currency},
      toCents(amount),
      `refund-order-${o.id}`
    );
    await db.$transaction(async tx => {
      // Guard against a concurrent refund.
      const r = await tx.shopOrder.updateMany({where: {id: o.id, payment: 'Paid'}, data: {payment: 'Refunded'}});
      if (!r.count) throw conflict('ALREADY_REFUNDED', 'This order has already been refunded');
      const units = input.restock ? await restockLines(tx, remaining) : 0;
      await tx.shopOrderEvent.create({
        data: {orderId: o.id, kind: 'refund', message: refundMessage(refundedCents, o.currency, input.restock, units, input.note), by},
        select: {id: true},
      });
    });
    await sendOrderEmail(c, db, o.id, 'order_refunded', {refundAmountCents: refundedCents});
    c.header('Cache-Control', 'private, no-store');
    return c.json(adminOrder(await loadAdminOrder(db, o.number)));
  });
