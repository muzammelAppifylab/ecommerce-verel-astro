import {Hono} from 'hono';
import {z} from 'zod';

import {Prisma} from '../../../generated/prisma/client';
import {withDb} from '../../../platform/guards';
import type {AdminAnalytics} from '../../../lib/types/admin/analytics';
import {EVENT_TYPES} from '../../../lib/types/events';
import type {Db} from '../../lib/db';
import {fromCents, round2} from '../../lib/money';
import {InputError, query} from '../../lib/validate';

/**
 * Admin: Analytics (WP-16). Port of VAREL worker/routes/admin/analytics.ts (+ `chartBuckets`/`isoDate`
 * from worker/routes/admin/util.ts): VAREL `/api/admin/analytics` is `/site-api/manage/analytics` here.
 *
 *   GET    /site-api/manage/analytics                  AdminAnalytics ?from=YYYY-MM-DD&to=YYYY-MM-DD | ?days=7|30|90|all
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: analytics = `site:analytics:read`), then the activity log.
 *
 * Ranges are UTC days, `to` inclusive, default the last 30 days; `days=all` is the lifetime (from the first
 * paid order or event; never shorter than 30 days). Sessions and funnel steps count distinct visitor ids
 * (`analytics_events.session_id`); purchases and revenue come from paid orders, never from events.
 *
 * Every figure is aggregated in Postgres over a date-bounded range served by the `(type, created_at)` /
 * `(payment, placed_at)` indexes and returns a few small rows: a staff-only report, the documented
 * exception to "no aggregates per request" (docs/migration/handoff/WP-16.md).
 */

export const DAY = 86_400_000;

/** `YYYY-MM-DD` of a UTC instant. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** UTC midnight of a `YYYY-MM-DD` day, in ms. */
export const dayStart = (s: string) => new Date(`${s}T00:00:00.000Z`).getTime();

/** True for a real calendar day (`2026-02-31` is not). */
export const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = dayStart(s);
  return Number.isFinite(t) && isoDate(new Date(t)) === s;
};

/** UTC midnight of today (or of `now`), in ms. */
export const todayStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

export interface ChartBucket {
  date: string;
  total: number;
  orders: number;
}

/** Revenue chart buckets over [start, end) (UTC ms): one per day up to 92 days, one per calendar month beyond, so a
    lifetime chart stays readable. Keys are ISO dates (the 1st for months); `keyOf` maps a timestamp to its bucket. */
export function chartBuckets(start: number, end: number) {
  const bucket: 'day' | 'month' = end - start > 92 * DAY ? 'month' : 'day';
  const keyOf = (d: Date) => (bucket === 'day' ? isoDate(d) : `${isoDate(d).slice(0, 7)}-01`);
  const map = new Map<string, ChartBucket>();
  if (bucket === 'day') {
    for (let t = start; t < end; t += DAY) map.set(isoDate(new Date(t)), {date: isoDate(new Date(t)), total: 0, orders: 0});
  } else {
    const s = new Date(start);
    for (let m = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1); m < end; ) {
      const date = isoDate(new Date(m));
      map.set(date, {date, total: 0, orders: 0});
      const d = new Date(m);
      m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
  }
  return {bucket, keyOf, map};
}

/** `'day'` or `'month'` as a SQL literal for `date_trunc` (from `chartBuckets`, never user input). */
export const truncUnit = (bucket: 'day' | 'month') => Prisma.raw(bucket === 'month' ? `'month'` : `'day'`);

// ─── Range rules ─────────────────────────────────────────────────────────────

const DATE_HINT = 'Use a date such as 2026-10-01';
const isoDay = z.string().trim().max(10, DATE_HINT).refine(isRealDate, DATE_HINT).optional();

export const analyticsParams = z.object({
  from: isoDay,
  to: isoDay,
  days: z.enum(['7', '30', '90', 'all'], {error: 'Use 7, 30, 90 or all'}).optional(),
});
export type AnalyticsParams = z.output<typeof analyticsParams>;

export interface AnalyticsRange {
  /** Inclusive start, UTC ms. */
  start: number;
  /** Exclusive end, UTC ms. */
  end: number;
  days: number;
  lifetime: boolean;
  custom: boolean;
}

/** Is the asked range the lifetime (so the first order / event must be read first)? */
export const isLifetime = (q: AnalyticsParams) => !(q.from || q.to) && q.days === 'all';

/**
 * The analytics window (VAREL L57–72). `first` is the earliest paid order or event (UTC ms), read only for the
 * lifetime, which never shortens the default 30 days. Throws a 422 (`InputError`) for a start after the end
 * or a custom range over a year (the lifetime is exempt).
 */
export function resolveRange(q: AnalyticsParams, today: number, first?: number | null): AnalyticsRange {
  const custom = !!(q.from || q.to);
  const lifetime = !custom && q.days === 'all';
  const end = q.to ? dayStart(q.to) + DAY : today + DAY; // exclusive
  let start = q.from ? dayStart(q.from) : end - (custom || !q.days || lifetime ? 30 : Number(q.days)) * DAY;
  if (lifetime && first != null && Number.isFinite(first)) start = Math.min(start, Math.floor(first / DAY) * DAY);
  if (start >= end) throw new InputError({from: 'Start on or before the end date'});
  const days = Math.round((end - start) / DAY);
  if (!lifetime && days > 366) throw new InputError({from: 'Choose a range of a year or less'});
  return {start, end, days, lifetime, custom};
}

/**
 * The dashboard window (VAREL admin/dashboard.ts): the last `period` UTC days including today (7, 30 or 90;
 * anything else is 30), compared with the same length before it. The lifetime (`'all'`) starts on the first
 * order's day (today when there is none) and has no previous window. `firstOrder` is read only for it.
 */
export function resolvePeriod(days: string | undefined, today: number, firstOrder?: Date | null) {
  const lifetime = days === 'all';
  const asked = Number(days);
  let period = [7, 30, 90].includes(asked) ? asked : 30;
  if (lifetime) {
    const f = firstOrder ?? new Date(today);
    period = Math.max(1, Math.round((today - Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate())) / DAY) + 1);
  }
  const start = today - (period - 1) * DAY;
  const end = today + DAY;
  const prevStart = lifetime ? start : start - period * DAY;
  return {lifetime, period, start, end, prevStart};
}

// ─── Route ───────────────────────────────────────────────────────────────────

/** The event types as an `IN` list, so every events read is served by the `(type, created_at)` index. */
const TYPES = Prisma.join([...EVENT_TYPES]);

/** The earliest paid order or event (UTC ms): one indexed read per event type plus the first paid order. */
async function firstActivity(db: Db): Promise<number | null> {
  const [order, ...events] = await Promise.all([
    db.shopOrder.findFirst({where: {payment: 'Paid'}, orderBy: {placedAt: 'asc'}, select: {placedAt: true}}),
    ...EVENT_TYPES.map(type => db.analyticsEvent.findFirst({where: {type}, orderBy: {createdAt: 'asc'}, select: {createdAt: true}})),
  ]);
  const times = [order?.placedAt, ...events.map(e => e?.createdAt)].filter((d): d is Date => !!d).map(d => d.getTime());
  return times.length ? Math.min(...times) : null;
}

export const analyticsAdmin = new Hono().get('/', query(analyticsParams), withDb, async c => {
  const db = c.var.db;
  const q = c.req.valid('query');
  const first = isLifetime(q) ? await firstActivity(db) : null;
  const range = resolveRange(q, todayStart(), first);
  const gte = new Date(range.start);
  const lt = new Date(range.end);
  const chart = chartBuckets(range.start, range.end);
  const unit = truncUnit(chart.bucket);

  const [byType, sessionsRow, orderBuckets, lines, views, searches, empty] = await Promise.all([
    db.$queryRaw<{type: string; sessions: number; events: number}[]>`
      SELECT "type", COUNT(DISTINCT "session_id")::int AS sessions, COUNT(*)::int AS events
      FROM "analytics_events"
      WHERE "type" IN (${TYPES}) AND "created_at" >= ${gte} AND "created_at" < ${lt}
      GROUP BY "type"`,
    db.$queryRaw<{sessions: number}[]>`
      SELECT COUNT(DISTINCT "session_id")::int AS sessions
      FROM "analytics_events"
      WHERE "type" IN (${TYPES}) AND "created_at" >= ${gte} AND "created_at" < ${lt}`,
    db.$queryRaw<{b: string; orders: number; cents: bigint | number | null}[]>`
      SELECT to_char(date_trunc(${unit}, "placed_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS b,
             COUNT(*)::int AS orders, SUM("total_cents")::bigint AS cents
      FROM "shop_orders"
      WHERE "payment" = 'Paid' AND "placed_at" >= ${gte} AND "placed_at" < ${lt}
      GROUP BY 1`,
    db.$queryRaw<{dept: string; cat: string; cents: bigint | number | null; units: number}[]>`
      SELECT COALESCE(d."name", 'Unlisted') AS dept, COALESCE(c."name", i."category") AS cat,
             SUM(i."price_cents" * i."qty" - i."discount_cents")::bigint AS cents, SUM(i."qty")::int AS units
      FROM "shop_order_items" i
      JOIN "shop_orders" o ON o."id" = i."order_id"
      LEFT JOIN "products" p ON p."id" = i."product_id"
      LEFT JOIN "departments" d ON d."id" = p."department_id"
      LEFT JOIN "categories" c ON c."id" = p."category_id"
      WHERE o."payment" = 'Paid' AND o."placed_at" >= ${gte} AND o."placed_at" < ${lt}
      GROUP BY 1, 2
      LIMIT 500`,
    db.$queryRaw<{product_id: string; views: number}[]>`
      SELECT "product_id", COUNT(*)::int AS views
      FROM "analytics_events"
      WHERE "type" = 'product_view' AND "product_id" IS NOT NULL AND "created_at" >= ${gte} AND "created_at" < ${lt}
      GROUP BY "product_id"
      ORDER BY views DESC, "product_id" ASC
      LIMIT 10`,
    db.$queryRaw<{query: string; count: number; avg: number | null}[]>`
      SELECT "query", COUNT(*)::int AS count, AVG("results")::float AS avg
      FROM "analytics_events"
      WHERE "type" = 'search' AND "query" IS NOT NULL AND "query" <> '' AND "created_at" >= ${gte} AND "created_at" < ${lt}
      GROUP BY "query" ORDER BY count DESC, "query" ASC LIMIT 10`,
    db.$queryRaw<{query: string; count: number; last: Date}[]>`
      SELECT "query", COUNT(*)::int AS count, MAX("created_at") AS last
      FROM "analytics_events"
      WHERE "type" = 'search' AND "results" = 0 AND "query" IS NOT NULL AND "query" <> '' AND "created_at" >= ${gte} AND "created_at" < ${lt}
      GROUP BY "query" ORDER BY count DESC, last DESC LIMIT 10`,
  ]);

  // Names and adds to bag for the most viewed products only (≤ 10 ids).
  const viewIds = views.map(v => v.product_id);
  const [products, adds] = viewIds.length
    ? await Promise.all([
        db.product.findMany({where: {id: {in: viewIds}}, select: {id: true, name: true}, take: 10}),
        db.$queryRaw<{product_id: string; n: number}[]>`
          SELECT "product_id", COUNT(*)::int AS n
          FROM "analytics_events"
          WHERE "type" = 'add_to_cart' AND "product_id" IN (${Prisma.join(viewIds)})
            AND "created_at" >= ${gte} AND "created_at" < ${lt}
          GROUP BY "product_id"`,
      ])
    : [[], []];
  const names = new Map(products.map(p => [p.id, p.name]));
  const addCount = new Map(adds.map(a => [a.product_id, a.n]));

  const sessionsOf = (t: string) => byType.find(r => r.type === t)?.sessions ?? 0;
  const eventsOf = (t: string) => byType.find(r => r.type === t)?.events ?? 0;
  const sessions = sessionsRow[0]?.sessions ?? 0;

  let paidOrders = 0;
  let revenueCents = 0;
  for (const r of orderBuckets) {
    paidOrders += r.orders;
    revenueCents += Number(r.cents ?? 0);
    const d = chart.map.get(r.b);
    if (d) {
      d.orders += r.orders;
      d.total = round2(d.total + fromCents(r.cents ?? 0));
    }
  }
  const revenue = fromCents(revenueCents);

  const depts = new Map<string, {name: string; revenue: number; units: number}>();
  const cats: {name: string; department: string; revenue: number; units: number}[] = [];
  for (const l of lines) {
    const amount = fromCents(l.cents ?? 0);
    const dv = depts.get(l.dept) ?? {name: l.dept, revenue: 0, units: 0};
    dv.revenue = round2(dv.revenue + amount);
    dv.units += l.units;
    depts.set(l.dept, dv);
    cats.push({name: l.cat, department: l.dept, revenue: amount, units: l.units});
  }
  const byRevenue = (a: {revenue: number; name: string}, b: {revenue: number; name: string}) =>
    b.revenue - a.revenue || a.name.localeCompare(b.name);

  const out: AdminAnalytics = {
    from: isoDate(gte),
    to: isoDate(new Date(range.end - DAY)),
    days: range.days,
    lifetime: range.lifetime,
    bucket: chart.bucket,
    totals: {
      sessions,
      pageViews: eventsOf('page_view'),
      productViews: eventsOf('product_view'),
      orders: paidOrders,
      revenue,
      averageOrder: paidOrders ? round2(revenue / paidOrders) : 0,
      conversionRate: sessions ? Math.round((paidOrders / sessions) * 10_000) / 10_000 : 0,
    },
    funnel: [
      {key: 'sessions', label: 'Sessions', count: sessions},
      {key: 'product_view', label: 'Viewed a product', count: sessionsOf('product_view')},
      {key: 'add_to_cart', label: 'Added to bag', count: sessionsOf('add_to_cart')},
      {key: 'checkout_start', label: 'Started checkout', count: sessionsOf('checkout_start')},
      {key: 'purchase', label: 'Purchased', count: paidOrders},
    ],
    revenueByDay: [...chart.map.values()],
    revenueByDepartment: [...depts.values()].sort(byRevenue).slice(0, 100),
    revenueByCategory: cats.sort(byRevenue).slice(0, 12),
    topProducts: views.map(v => ({
      productId: v.product_id,
      name: names.get(v.product_id) ?? v.product_id,
      views: v.views,
      addToBag: addCount.get(v.product_id) ?? 0,
    })),
    topSearches: searches.map(s => ({
      query: s.query,
      count: s.count,
      avgResults: s.avg ? Math.max(0.1, Math.round(s.avg * 10) / 10) : 0,
    })),
    noResultSearches: empty.map(s => ({query: s.query, count: s.count, lastSearched: new Date(s.last).toISOString()})),
  };
  return c.json(out);
});
