import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import {withDb} from '../../../platform/guards';
import type {AdminDashboard} from '../../../lib/types/admin/analytics';
import type {InventoryRow} from '../../../lib/types/admin/catalog';
import type {AdminOrderRow} from '../../../lib/types/admin/sales';
import type {Photo} from '../../../lib/types/common';
import type {FulfillmentStatus, PaymentStatus} from '../../../lib/types/orders';
import type {Db} from '../../lib/db';
import {displayDate} from '../../lib/format';
import {fromCents, round2} from '../../lib/money';
import {optionValues} from '../../lib/variant-options';
import {query} from '../../lib/validate';
import {chartBuckets, isoDate, resolvePeriod, todayStart, truncUnit} from './analytics';

/**
 * Admin: Overview (WP-16). Port of VAREL worker/routes/admin/dashboard.ts: VAREL `/api/admin/dashboard` is
 * `/site-api/manage/dashboard` here.
 *
 *   GET    /site-api/manage/dashboard/counts           DashboardCounts (the sidebar's open orders / pending returns)
 *   GET    /site-api/manage/dashboard                  AdminDashboard ?days=7|30|90|all
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: any staff; MANAGE_AREAS in src/server/permissions.ts), then the activity log.
 *
 * Aggregates over a 7, 30 or 90-day window (UTC days), compared with the window before it, or over the store's
 * lifetime (`?days=all`: from the first order, no comparison). Field names keep their historical "30d" suffix;
 * `periodDays` says how many days they cover. Orders count every order that did not fail and was not
 * cancelled; revenue counts paid orders only.
 *
 * VAREL loaded every order of both windows into the Worker; here Postgres aggregates a date-bounded range
 * (index `(placed_at desc, id desc)`) into ≤ 2×92 small rows (or months), and the counters are CAPPED
 * (`LIMIT` inside a subquery): `COUNT_CAP` for open orders / returns, `CUSTOMER_CAP` for customers. The UI
 * writes a capped number as "1,000+". Staff-only report: the documented exception to "no count() per
 * request" (docs/migration/handoff/WP-16.md).
 */

/** Open orders and pending returns are counted up to this (the UI shows "1,000+"). */
export const COUNT_CAP = 1000;
/** Customer accounts are counted up to this (the UI shows "10,000+"). */
export const CUSTOMER_CAP = 10_000;
/** Low stock when nothing is configured (settings.low_stock_threshold default). */
const DEFAULT_LOW_STOCK = 6;

/** The sidebar counters (`src/portal/queries/overview.ts` `NavCounts`). */
export interface DashboardCounts {
  openOrders: number;
  pendingReturns: number;
}

// ─── Row mappers (VAREL admin/serializers.ts; WP-18/WP-19 keep their own copies) ─────────────────────────

const addressName = (json: Prisma.JsonValue | null): string | null => {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const n = (json as Record<string, unknown>).name;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return null;
};

/** The customer's name: profile first + last name → account name → shipping name → email. */
export function customerNameOf(o: {
  address: Prisma.JsonValue | null;
  email: string;
  user: {name: string; customerProfile: {firstName: string; lastName: string} | null} | null;
}): string {
  const profile = o.user?.customerProfile;
  const full = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
  if (full) return full;
  if (o.user?.name?.trim()) return o.user.name.trim();
  return addressName(o.address) ?? o.email;
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
  user: {select: {name: true, customerProfile: {select: {firstName: true, lastName: true}}}},
  items: {select: {qty: true}, take: 100},
} satisfies Prisma.ShopOrderSelect;

type RecentOrder = Prisma.ShopOrderGetPayload<{select: typeof recentOrderSelect}>;

export function recentOrderRow(o: RecentOrder): AdminOrderRow {
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

/** Per-variant stock: 0 out, 1–lowStock low, otherwise in (same threshold as the storefront). */
export const variantState = (inventory: number, lowStock: number): InventoryRow['state'] =>
  inventory <= 0 ? 'out' : inventory <= lowStock ? 'low' : 'in';

interface LowStockSql {
  id: string;
  product_id: string;
  color: string | null;
  size: string | null;
  options: Prisma.JsonValue;
  inventory: number;
  name: string;
  image: {src: string; credit: string | null; creditHref: string | null} | null;
}

export function lowStockRow(v: LowStockSql, lowStock: number): InventoryRow {
  const inventory = v.inventory ?? 0;
  const image: Photo | null = v.image?.src ? {src: v.image.src, credit: v.image.credit ?? '', creditHref: v.image.creditHref ?? ''} : null;
  return {
    variantId: v.id,
    productId: v.product_id,
    productName: v.name,
    color: v.color,
    size: v.size,
    options: optionValues(v.options),
    inventory,
    state: variantState(inventory, lowStock),
    image,
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Open orders (Unfulfilled / Processing, not Failed) and pending returns, each capped at `COUNT_CAP`. */
async function readCounts(db: Db): Promise<DashboardCounts> {
  const [row] = await db.$queryRaw<{open_orders: number; pending_returns: number}[]>`
    SELECT
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM "shop_orders"
        WHERE "fulfillment" IN ('Unfulfilled', 'Processing') AND "payment" <> 'Failed'
        LIMIT ${COUNT_CAP}) t) AS open_orders,
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM "return_requests"
        WHERE "status" IN ('Requested', 'Approved', 'Received')
        LIMIT ${COUNT_CAP}) t) AS pending_returns`;
  return {openOrders: row?.open_orders ?? 0, pendingReturns: row?.pending_returns ?? 0};
}

/**
 * Customer accounts: users holding the `member` role and none of the team roles (owner, admin, staff),
 * all time and created since `since`, each capped at `CUSTOMER_CAP`. `users.created_at` is a UTC timestamp
 * without time zone (template schema), so `since` is converted to UTC before comparing.
 */
async function readCustomers(db: Db, since: Date): Promise<{customers: number; newCustomers: number}> {
  const [row] = await db.$queryRaw<{customers: number; new_customers: number}[]>`
    SELECT
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
        WHERE r."slug" = 'member' AND NOT EXISTS (
          SELECT 1 FROM "user_roles" x JOIN "roles" y ON y."id" = x."role_id"
          WHERE x."user_id" = ur."user_id" AND y."slug" IN ('owner', 'admin', 'staff'))
        LIMIT ${CUSTOMER_CAP}) t) AS customers,
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
        JOIN "users" u ON u."id" = ur."user_id"
        WHERE r."slug" = 'member' AND u."created_at" >= (${since}::timestamptz AT TIME ZONE 'UTC') AND NOT EXISTS (
          SELECT 1 FROM "user_roles" x JOIN "roles" y ON y."id" = x."role_id"
          WHERE x."user_id" = ur."user_id" AND y."slug" IN ('owner', 'admin', 'staff'))
        LIMIT ${CUSTOMER_CAP}) t) AS new_customers`;
  return {customers: row?.customers ?? 0, newCustomers: row?.new_customers ?? 0};
}

const dashboardParams = z.object({days: z.string().max(8).optional()});

export const dashboardAdmin = new Hono()
  .get('/counts', withDb, async c => c.json<DashboardCounts>(await readCounts(c.var.db)))
  .get('/', query(dashboardParams), withDb, async c => {
    const db = c.var.db;
    const days = c.req.valid('query').days;
    const today = todayStart();
    const first =
      days === 'all'
        ? await db.shopOrder.findFirst({where: {payment: {not: 'Failed'}}, orderBy: {placedAt: 'asc'}, select: {placedAt: true}})
        : null;
    const w = resolvePeriod(days, today, first?.placedAt ?? null);
    const start = new Date(w.start);
    const end = new Date(w.end);
    const prevStart = new Date(w.prevStart);
    const chart = chartBuckets(w.start, w.end);
    const unit = truncUnit(chart.bucket);

    const [buckets, top, counts, customers, settings, recent] = await Promise.all([
      // Both windows, by bucket: every order that did not fail and was not cancelled; paid ones carry the revenue.
      db.$queryRaw<{b: string; cur: boolean; orders: number; paid: number; paid_cents: bigint | number | null}[]>`
        SELECT to_char(date_trunc(${unit}, o."placed_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS b,
               (o."placed_at" >= ${start}) AS cur,
               COUNT(*)::int AS orders,
               (COUNT(*) FILTER (WHERE o."payment" = 'Paid'))::int AS paid,
               COALESCE(SUM(o."total_cents") FILTER (WHERE o."payment" = 'Paid'), 0)::bigint AS paid_cents
        FROM "shop_orders" o
        WHERE o."placed_at" >= ${prevStart} AND o."placed_at" < ${end}
          AND o."payment" <> 'Failed' AND o."fulfillment" <> 'Cancelled'
        GROUP BY 1, 2`,
      // Top 5 products of the window: paid, not cancelled, by units then gross revenue; name from the latest line.
      db.$queryRaw<{product_id: string; name: string; units: number; revenue_cents: bigint | number}[]>`
        SELECT i."product_id", (array_agg(i."name" ORDER BY o."placed_at" DESC))[1] AS name,
               SUM(i."qty")::int AS units, SUM(i."price_cents" * i."qty")::bigint AS revenue_cents
        FROM "shop_order_items" i
        JOIN "shop_orders" o ON o."id" = i."order_id"
        WHERE o."placed_at" >= ${start} AND o."placed_at" < ${end}
          AND o."payment" = 'Paid' AND o."fulfillment" <> 'Cancelled' AND i."product_id" IS NOT NULL
        GROUP BY i."product_id"
        ORDER BY units DESC, revenue_cents DESC, i."product_id" ASC
        LIMIT 5`,
      readCounts(db),
      readCustomers(db, start),
      db.setting.findUnique({where: {id: 1}, select: {lowStockThreshold: true}}),
      db.shopOrder.findMany({select: recentOrderSelect, orderBy: [{placedAt: 'desc'}, {id: 'desc'}], take: 8}),
    ]);
    const lowStock = settings?.lowStockThreshold ?? DEFAULT_LOW_STOCK;

    // Physical, not archived products at or below the threshold: ≤ 10 rows, lowest stock first.
    const low = await db.$queryRaw<LowStockSql[]>`
      SELECT v."id", v."product_id", v."color", v."size", v."options", v."inventory", p."name",
             (SELECT json_build_object('src', pi."src", 'credit', pi."credit", 'creditHref', pi."credit_href")
              FROM "product_images" pi WHERE pi."product_id" = p."id" ORDER BY pi."position" ASC LIMIT 1) AS image
      FROM "variants" v
      JOIN "products" p ON p."id" = v."product_id"
      WHERE v."inventory" IS NOT NULL AND v."inventory" <= ${lowStock}
        AND p."type" = 'physical' AND p."status" <> 'archived'
      ORDER BY v."inventory" ASC, v."product_id" ASC, v."position" ASC
      LIMIT 10`;

    let revenueCents = 0;
    let prevRevenueCents = 0;
    let orders = 0;
    let prevOrders = 0;
    let paid = 0;
    for (const r of buckets) {
      if (r.cur) {
        orders += r.orders;
        paid += r.paid;
        revenueCents += Number(r.paid_cents ?? 0);
        const d = chart.map.get(r.b);
        if (d) {
          d.orders += r.orders;
          d.total = round2(d.total + fromCents(r.paid_cents ?? 0));
        }
      } else {
        prevOrders += r.orders;
        prevRevenueCents += Number(r.paid_cents ?? 0);
      }
    }
    const revenue = fromCents(revenueCents);

    const out: AdminDashboard = {
      periodDays: w.period,
      lifetime: w.lifetime,
      since: isoDate(start),
      salesBucket: chart.bucket,
      revenue30d: revenue,
      revenuePrev30d: w.lifetime ? 0 : fromCents(prevRevenueCents),
      orders30d: orders,
      ordersPrev30d: w.lifetime ? 0 : prevOrders,
      averageOrder30d: paid ? round2(revenue / paid) : 0,
      customers: customers.customers,
      newCustomers30d: customers.newCustomers,
      openOrders: counts.openOrders,
      pendingReturns: counts.pendingReturns,
      salesByDay: [...chart.map.values()],
      topProducts: top.map(t => ({productId: t.product_id, name: t.name, units: t.units, revenue: fromCents(t.revenue_cents)})),
      lowStock: low.map(v => lowStockRow(v, lowStock)),
      recentOrders: recent.map(recentOrderRow),
    };
    return c.json(out);
  });
