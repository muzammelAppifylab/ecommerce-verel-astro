/* Admin: performance report for one discount — totals, last 30 days (UTC, zero-filled) and the 20 latest
   redemptions (port of VAREL worker/routes/admin/discount-report.ts). */
import type {Prisma} from '../../../generated/prisma/client';
import type {AdminDiscountReport} from '../../../lib/types/admin/promotions';
import type {Db} from '../../lib/db';
import {notFound} from '../../lib/errors';
import {fromCents, round2} from '../../lib/money';
import {DISCOUNT_SELECT, serializeOne} from './discount-shared';

const DAYS = 30;
const DAY_MS = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const addressName = (json: Prisma.JsonValue | null): string | null => {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const n = (json as Record<string, unknown>).name;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return null;
};

/** VAREL `customerNameOf`: the account's name (profile first + last, else the account name), else the shipping
    name, else the email. */
export function customerNameOf(o: {
  address: Prisma.JsonValue | null;
  email: string;
  user: {name: string; customerProfile: {firstName: string; lastName: string} | null} | null;
}): string {
  if (o.user) {
    const profile = o.user.customerProfile ? `${o.user.customerProfile.firstName} ${o.user.customerProfile.lastName}`.trim() : '';
    const name = profile || o.user.name.trim();
    if (name) return name;
  }
  return addressName(o.address) ?? o.email;
}

/** The 30 UTC days ending today, oldest first, zero-filled. */
export function zeroFilledDays(
  from: Date,
  rows: {day: string; uses: number; amount: bigint | number; revenue: bigint | number}[]
): AdminDiscountReport['byDay'] {
  const byDate = new Map(rows.map(r => [r.day, r]));
  const out: AdminDiscountReport['byDay'] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = isoDate(new Date(from.getTime() + i * DAY_MS));
    const r = byDate.get(date);
    out.push({date, uses: r ? Number(r.uses) : 0, discount: r ? fromCents(r.amount) : 0, revenue: r ? fromCents(r.revenue) : 0});
  }
  return out;
}

export async function discountReport(db: Db, id: number, now = new Date()): Promise<AdminDiscountReport> {
  const d = await db.discount.findUnique({where: {id}, select: DISCOUNT_SELECT});
  if (!d) throw notFound('We cannot find that discount');

  const today = new Date(`${isoDate(now)}T00:00:00.000Z`);
  const from = new Date(today.getTime() - (DAYS - 1) * DAY_MS);

  const [discount, totals, days, recent] = await Promise.all([
    serializeOne(db, d),
    // Uses count every redemption (what the usage limit counts: pending and refunded orders too). Money (discount
    // given, revenue, average order) counts paid orders only, as Analytics does. A customer is one email.
    db.$queryRaw<{uses: number; paid: number; customers: number; amount: bigint | number; revenue: bigint | number}[]>`
      SELECT COUNT(*)::int AS "uses",
             COUNT(*) FILTER (WHERE o.payment = 'Paid')::int AS "paid",
             COUNT(DISTINCT LOWER(r.email))::int AS "customers",
             COALESCE(SUM(r.amount_cents) FILTER (WHERE o.payment = 'Paid'), 0)::bigint AS "amount",
             COALESCE(SUM(o.total_cents) FILTER (WHERE o.payment = 'Paid'), 0)::bigint AS "revenue"
      FROM discount_redemptions r JOIN shop_orders o ON o.id = r.order_id
      WHERE r.discount_id = ${d.id}`,
    db.$queryRaw<{day: string; uses: number; amount: bigint | number; revenue: bigint | number}[]>`
      SELECT to_char(o.placed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day", COUNT(*)::int AS "uses",
             COALESCE(SUM(r.amount_cents) FILTER (WHERE o.payment = 'Paid'), 0)::bigint AS "amount",
             COALESCE(SUM(o.total_cents) FILTER (WHERE o.payment = 'Paid'), 0)::bigint AS "revenue"
      FROM discount_redemptions r JOIN shop_orders o ON o.id = r.order_id
      WHERE r.discount_id = ${d.id} AND o.placed_at >= ${from}
      GROUP BY 1`,
    db.discountRedemption.findMany({
      where: {discountId: d.id},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      take: 20,
      select: {
        code: true,
        amountCents: true,
        email: true,
        order: {
          select: {
            number: true,
            placedAt: true,
            totalCents: true,
            email: true,
            address: true,
            user: {select: {name: true, customerProfile: {select: {firstName: true, lastName: true}}}},
          },
        },
      },
    }),
  ]);

  const t = totals[0] ?? {uses: 0, paid: 0, customers: 0, amount: 0, revenue: 0};
  const paid = Number(t.paid);
  const revenue = fromCents(t.revenue);
  return {
    discount,
    uses: Number(t.uses),
    customers: Number(t.customers),
    discountGiven: fromCents(t.amount),
    revenue,
    averageOrder: paid ? round2(revenue / paid) : 0,
    byDay: zeroFilledDays(from, days),
    recent: recent.map(r => ({
      orderNumber: r.order.number,
      placedAt: r.order.placedAt.toISOString(),
      customer: customerNameOf(r.order),
      email: r.order.email,
      code: r.code,
      amount: fromCents(r.amountCents),
      orderTotal: fromCents(r.order.totalCents),
    })),
  };
}
