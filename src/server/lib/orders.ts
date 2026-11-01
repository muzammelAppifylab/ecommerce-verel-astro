/* Order numbers, ownership and refund maths (port of VAREL worker/lib/orders.ts). Orders live in `shop_orders`
   (PLAN.md D4: model ShopOrder); money there is integer cents, the refund helpers take currency units. */
import type { Prisma } from '../../generated/prisma/client'
import type { Db } from './db'
import { normEmail } from './format'
import type { DecimalLike } from './money'

export const FIRST_ORDER_NUMBER = 24817

/** Status-event message prefix written when an order is delivered (returns window starts there). */
export const DELIVERED_EVENT = 'Marked as delivered'

/** Setting.orderPrefix (default "VRL-"); getSettings() keeps it current (public and small: module memory is fine). */
let orderPrefix = 'VRL-'
export const setOrderPrefix = (p: string) => {
  if (p) orderPrefix = p
}
export const getOrderPrefix = () => orderPrefix

/** Prefix + 5 digits ("VRL-24914"), increasing from the highest existing number whatever its prefix, so changing
    the prefix in settings continues the sequence. */
export async function nextOrderNumber(db: Db, prefix = orderPrefix): Promise<string> {
  const rows = await db.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("number" FROM '([0-9]+)$') AS INTEGER)) AS max FROM "shop_orders" WHERE "number" ~ '[0-9]+$'`
  const max = rows[0]?.max ?? FIRST_ORDER_NUMBER - 1
  return `${prefix}${String(Number(max) + 1).padStart(5, '0')}`
}

/** "24817" → "<prefix>24817", "vrl24817" → "VRL-24817"; anything else is upper-cased as typed. */
export const normalizeOrderNumber = (n: string, prefix = orderPrefix) => {
  const t = n.trim().toUpperCase().replace(/\s+/g, '')
  if (/^\d+$/.test(t)) return `${prefix}${t}`
  if (/^VRL\d+$/.test(t)) return `VRL-${t.slice(3)}`
  return t
}

/** A customer may cancel until the order is packed: still unfulfilled at stage 1, and paid or awaiting payment. */
export const canCancel = (o: { fulfillment: string; stage: number; payment: string }) =>
  o.fulfillment === 'Unfulfilled' && o.stage <= 1 && (o.payment === 'Paid' || o.payment === 'Pending')

/** Orders that belong to a signed-in user: linked to the account, or placed as a guest with the same email. */
export const ownedBy = (user: { id: number; email: string }): Prisma.ShopOrderWhereInput => ({
  OR: [{ userId: user.id }, { userId: null, email: { equals: user.email, mode: 'insensitive' } }],
})

export const isOwner = (user: { id: number; email: string } | null, o: { userId: number | null; email: string }) =>
  !!user && (o.userId === user.id || (!o.userId && normEmail(o.email) === normEmail(user.email)))

type Money = DecimalLike
const n = (v: Money) => Number(v.toString())

/** What giving back `qty` units of an order line is worth: the line's price after its allocated discount
    (ShopOrderItem discount, docs/PROMOTIONS.md), plus its share of the order's tax when tax was added on top.
    Orders placed with tax-inclusive prices already contain the tax in the line price, so nothing is added.
    When the order snapshotted its rate, the share is net × rate (shipping tax stays out); older orders use
    the proportional share tax / taxable. Amounts in currency units (`fromCents` the order's columns first). */
export function lineRefund(
  order: { subtotal: Money; discount: Money; tax: Money; pricesIncludeTax?: boolean; taxRate?: Money | null },
  line: { price: Money; qty: number; discount: Money },
  qty: number,
): number {
  if (qty <= 0 || line.qty <= 0) return 0
  const lineTotal = n(line.price) * line.qty
  const net = Math.max(0, lineTotal - n(line.discount)) * (Math.min(qty, line.qty) / line.qty)
  let taxShare = 0
  if (!order.pricesIncludeTax && n(order.tax) > 0) {
    const taxable = n(order.subtotal) - n(order.discount)
    taxShare = order.taxRate != null ? net * n(order.taxRate) : taxable > 0 ? net * (n(order.tax) / taxable) : 0
  }
  return Math.round((net + taxShare) * 100 + 1e-7) / 100
}

/** Shipping given back when a return completes the whole order and Setting.refundShipping is on: the shipping
    charge, plus its tax when tax was added on top of it (taxShipping, exclusive prices). */
export function shippingRefund(
  order: { shipping: Money; pricesIncludeTax?: boolean; taxRate?: Money | null },
  s: { refundShipping: boolean; taxShipping: boolean; taxRate: number },
): number {
  if (!s.refundShipping) return 0
  const ship = n(order.shipping)
  const rate = order.taxRate != null ? n(order.taxRate) : s.taxRate
  const tax = !order.pricesIncludeTax && s.taxShipping ? ship * rate : 0
  return Math.round((ship + tax) * 100 + 1e-7) / 100
}
