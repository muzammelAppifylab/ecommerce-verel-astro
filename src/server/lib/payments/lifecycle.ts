/* What happens to an order when its payment settles: paid, failed/canceled, refunded (port of VAREL
   worker/lib/payments/lifecycle.ts + the `notifyLowStock` trigger of worker/lib/email/triggers.ts).
   Every transition is a conditional update on ShopOrder.payment, so webhooks, the confirmation poll, the client cancel
   and the expiry job can all run (and re-run) in any order without doing anything twice. Money: integer cents. */
import type { Context } from 'hono'
import { Prisma } from '../../../generated/prisma/client'
import { config } from '../../../platform/config'
import { sendTemplate } from '../contracts'
import type { Db, DbClient } from '../db'
import { plural } from '../format'
import { fromCents } from '../money'
import { DELIVERED_EVENT } from '../orders'
import { getSettings } from '../settings'
import { variantMeta } from '../variant-options'
import { getProvider, type IntentInfo } from './index'

type Tx = Prisma.TransactionClient

/** Longest order event message (shop_order_events.message VarChar(2000)). */
const EVENT_MAX = 2000
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s)

/** "$148", "€24.60", "148 kr." — whole amounts without decimals, in the order's currency (major units). */
export function formatMoney(n: number, currency = 'USD'): string {
  const whole = Number.isInteger(Math.round(n * 100) / 100)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

export const cardLabel = (brand: string | null, last4: string | null) =>
  brand && last4 ? `${brand} ending ${last4}` : (brand ?? (last4 ? `card ending ${last4}` : null))

// ─── Emails ─────────────────────────────────────────────────────────────────

/** Where store emails are sent from: the database, the request (to queue the send job) and the site's address. */
export interface EmailCtx {
  db: Db
  origin: string
  requestUrl?: string
}

/** The email context of a Site API request. */
export function emailCtxOf(c: Context, db: Db): EmailCtx {
  return { db, origin: config.siteUrl ?? new URL(c.req.url).origin, requestUrl: c.req.url }
}

/** order_confirmation, with the variables documented for the email templates (VAREL docs/EMAIL.md). Never throws. */
export async function sendOrderConfirmation(ctx: EmailCtx, orderId: number): Promise<void> {
  try {
    const o = await ctx.db.shopOrder.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        email: true,
        address: true,
        currency: true,
        locale: true,
        method: true,
        cardBrand: true,
        cardLast4: true,
        subtotalCents: true,
        discountCents: true,
        shippingCents: true,
        taxCents: true,
        totalCents: true,
        items: {
          orderBy: { position: 'asc' },
          select: { name: true, color: true, size: true, options: true, qty: true, priceCents: true, discountCents: true },
        },
      },
    })
    if (!o) return
    const cur = o.currency || 'USD'
    const m = (cents: number) => formatMoney(fromCents(cents), cur)
    const address = o.address as { name?: string } | null
    const firstName = (typeof address?.name === 'string' ? address.name : '').split(' ')[0] || ''
    await sendTemplate(
      ctx.db,
      'order_confirmation',
      o.email,
      {
        firstName,
        orderNumber: o.number,
        orderUrl: `${ctx.origin}/order/${encodeURIComponent(o.number)}/confirmation/?email=${encodeURIComponent(o.email)}`,
        items: o.items.map((i) => ({
          name: i.name,
          meta: variantMeta(i),
          qty: i.qty,
          total: m(i.priceCents * i.qty - i.discountCents),
        })),
        subtotal: m(o.subtotalCents),
        discount: o.discountCents > 0 ? m(o.discountCents) : '',
        shipping: o.shippingCents > 0 ? m(o.shippingCents) : 'Free',
        tax: m(o.taxCents),
        total: m(o.totalCents),
        method: o.method,
        paymentMethod: cardLabel(o.cardBrand, o.cardLast4) ?? '',
      },
      { requestUrl: ctx.requestUrl, related: { type: 'order', id: o.number }, locale: o.locale },
    )
  } catch (err) {
    console.error('[payments] order_confirmation failed', err instanceof Error ? err.message : err)
  }
}

/** low_stock_alert after checkout: one email listing every variant this order took from above the low-stock
    threshold to at or below it. Call it after the order transaction commits with the purchased lines. Never throws. */
export async function notifyLowStock(
  ctx: EmailCtx,
  order: { id: number; number: string },
  lines: { variantId: string; qty: number }[],
): Promise<void> {
  try {
    if (!lines.length) return
    const s = await getSettings(ctx.db)
    const threshold = s.lowStockThreshold
    const variants = await ctx.db.variant.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.variantId))] }, inventory: { not: null } },
      select: { id: true, color: true, size: true, options: true, inventory: true, product: { select: { name: true } } },
    })
    const crossed = variants.filter((v) => {
      const bought = lines.filter((l) => l.variantId === v.id).reduce((a, l) => a + l.qty, 0)
      const now = v.inventory ?? 0
      return now <= threshold && now + bought > threshold
    })
    if (!crossed.length) return
    await sendTemplate(
      ctx.db,
      'low_stock_alert',
      s.staffAlertEmail || s.supportEmail,
      {
        orderNumber: order.number,
        threshold,
        items: crossed.map((v) => ({ name: v.product.name, meta: variantMeta(v), sku: v.id, stock: v.inventory ?? 0 })),
        inventoryUrl: `${ctx.origin}/dashboard/inventory`,
      },
      { requestUrl: ctx.requestUrl, related: { type: 'order', id: order.number } },
    )
  } catch (err) {
    console.error('[email] low_stock_alert failed', err instanceof Error ? err.message : err)
  }
}

// ─── Stock and discount usage ───────────────────────────────────────────────

/** Put reserved stock back (physical lines with tracked inventory). Safe inside a transaction. Returns the units
    restocked. (The `restockOrder` contract, src/server/lib/contracts.ts.) */
export async function restockOrder(tx: Db, orderId: number | string): Promise<number> {
  const id = Number(orderId)
  if (!Number.isSafeInteger(id)) return 0
  const items = await tx.shopOrderItem.findMany({ where: { orderId: id }, select: { sku: true, qty: true, digital: true } })
  let units = 0
  // One conditional increment per line (bounded by the order's lines; untracked variants stay untracked).
  for (const l of items) {
    if (l.digital || l.qty <= 0) continue
    const r = await tx.variant.updateMany({ where: { id: l.sku, inventory: { not: null } }, data: { inventory: { increment: l.qty } } })
    if (r.count) units += l.qty
  }
  return units
}

/** Discount usage a failed payment gave back (ShopOrder.releasedDiscounts), restored if the order is paid late. */
interface ReleasedDiscounts {
  redemptions: {
    discountId: number
    userId: number | null
    email: string
    code: string | null
    amountCents: number
    label?: string | null
    freeShipping?: boolean | null
  }[]
  codeIds: number[]
}

/** Record and release an order's discount usage (redemptions and unique codes), so others can use it. */
export async function releaseDiscounts(tx: Tx, orderId: number): Promise<void> {
  const [reds, codes] = await Promise.all([
    tx.discountRedemption.findMany({
      where: { orderId },
      select: { discountId: true, userId: true, email: true, code: true, amountCents: true, label: true, freeShipping: true },
    }),
    tx.discountCode.findMany({ where: { orderId }, select: { id: true } }),
  ])
  if (!reds.length && !codes.length) return
  const released: ReleasedDiscounts = { redemptions: reds, codeIds: codes.map((c) => c.id) }
  await tx.shopOrder.update({ where: { id: orderId }, data: { releasedDiscounts: released as unknown as Prisma.InputJsonValue } })
  await tx.discountRedemption.deleteMany({ where: { orderId } })
  await tx.discountCode.updateMany({ where: { orderId }, data: { usedAt: null, orderId: null } })
}

const asReleased = (raw: Prisma.JsonValue | null): ReleasedDiscounts | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as unknown as ReleasedDiscounts
  return Array.isArray(r.redemptions) && Array.isArray(r.codeIds) ? r : null
}

/** Take back the usage released by releaseDiscounts(). Returns the unique codes another order used meanwhile. */
export async function restoreDiscounts(tx: Tx, orderId: number, raw: Prisma.JsonValue | null): Promise<string[]> {
  const released = asReleased(raw)
  if (!released) return []
  // A discount with no other uses may have been deleted since; its redemption can't be written back.
  const ids = [...new Set(released.redemptions.map((r) => Number(r.discountId)))]
  const userIds = [...new Set(released.redemptions.flatMap((r) => (r.userId != null ? [Number(r.userId)] : [])))]
  const [discounts, users] = await Promise.all([
    ids.length ? tx.discount.findMany({ where: { id: { in: ids } }, select: { id: true } }) : [],
    userIds.length ? tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }) : [],
  ])
  const alive = new Set(discounts.map((d) => d.id))
  const people = new Set(users.map((u) => u.id))
  const rows = released.redemptions
    .filter((r) => alive.has(Number(r.discountId)))
    .map((r) => ({
      discountId: Number(r.discountId),
      orderId,
      userId: r.userId != null && people.has(Number(r.userId)) ? Number(r.userId) : null,
      email: r.email,
      code: r.code,
      amountCents: Math.max(0, Math.round(r.amountCents ?? 0)),
      label: r.label ?? null,
      freeShipping: r.freeShipping ?? null,
    }))
  if (rows.length) await tx.discountRedemption.createMany({ data: rows, skipDuplicates: true })
  const lost: string[] = []
  for (const id of released.codeIds) {
    const r = await tx.discountCode.updateMany({ where: { id: Number(id), usedAt: null, orderId: null }, data: { usedAt: new Date(), orderId } })
    if (!r.count) {
      const c = await tx.discountCode.findUnique({ where: { id: Number(id) }, select: { code: true } })
      if (c) lost.push(c.code)
    }
  }
  await tx.shopOrder.update({ where: { id: orderId }, data: { releasedDiscounts: Prisma.DbNull } })
  return lost
}

// ─── Transitions ────────────────────────────────────────────────────────────

/** Pending → Paid (or Failed → Paid when the money arrived late). Returns true when this call made the change (send
    the confirmation then). */
export async function markOrderPaid(
  db: DbClient,
  orderId: number,
  info: Pick<IntentInfo, 'brand' | 'last4'> & { ref?: string | null },
): Promise<boolean> {
  return db.$transaction(
    async (tx) => {
      const order = await tx.shopOrder.findUnique({
        where: { id: orderId },
        select: { payment: true, cardBrand: true, cardLast4: true, releasedDiscounts: true, items: { select: { digital: true } } },
      })
      if (!order) return false
      const digitalOnly = order.items.length > 0 && order.items.every((i) => i.digital)
      const card = { cardBrand: info.brand ?? order.cardBrand, cardLast4: info.last4 ?? order.cardLast4 }
      const delivered = digitalOnly ? { fulfillment: 'Delivered', stage: 4 } : {}

      let lateAfterFailure = false
      let lostCodes: string[] = []
      const r = await tx.shopOrder.updateMany({ where: { id: orderId, payment: 'Pending' }, data: { payment: 'Paid', ...card, ...delivered } })
      if (!r.count) {
        if (order.payment !== 'Failed') return false
        // Paid after the order was given up (rare: an async method settling late). Keep the money's truth:
        // the order is paid; take the stock again and flag it for the team.
        const again = await tx.shopOrder.updateMany({ where: { id: orderId, payment: 'Failed' }, data: { payment: 'Paid', ...card, ...delivered } })
        if (!again.count) return false
        lateAfterFailure = true
        const items = await tx.shopOrderItem.findMany({ where: { orderId }, select: { sku: true, qty: true, digital: true } })
        for (const l of items) {
          if (l.digital || l.qty <= 0) continue
          await tx.variant.updateMany({ where: { id: l.sku, inventory: { not: null } }, data: { inventory: { decrement: l.qty } } })
        }
        // The order keeps its discount, so it counts toward usage limits and reports again.
        lostCodes = await restoreDiscounts(tx, orderId, order.releasedDiscounts)
      }

      await tx.shopPayment.updateMany({
        where: { orderId, ...(info.ref ? { providerRef: info.ref } : {}) },
        data: { status: 'succeeded', ...(info.brand ? { cardBrand: info.brand } : {}), ...(info.last4 ? { cardLast4: info.last4 } : {}), failureMessage: null },
      })
      const label = cardLabel(info.brand, info.last4)
      const events: Prisma.ShopOrderEventCreateManyInput[] = [
        {
          orderId,
          kind: 'status',
          message: clip(
            lateAfterFailure
              ? `Payment received after the order was cancelled${label ? ` · ${label}` : ''} · stock taken again, check availability${
                  lostCodes.length ? ` · ${lostCodes.join(', ')} was used by another order meanwhile` : ''
                }`
              : `Payment received${label ? ` · ${label}` : ''}`,
            EVENT_MAX,
          ),
        },
      ]
      if (digitalOnly) events.push({ orderId, kind: 'status', message: `${DELIVERED_EVENT} · digital delivery`, at: new Date(Date.now() + 1) })
      await tx.shopOrderEvent.createMany({ data: events })
      return true
    },
    { timeout: 15_000, maxWait: 5_000 },
  )
}

export interface FailOptions {
  status: 'failed' | 'canceled'
  message: string | null
  /** Who or what gave up on it, for the event, e.g. "Payment expired after 60 minutes". */
  reason?: string
}

/** Pending → Failed: restock, release discount usage (redemptions and unique codes). Returns true when this call
    made the change. */
export async function failOrder(db: DbClient, orderId: number, opts: FailOptions): Promise<boolean> {
  const message = opts.message ? clip(opts.message, 500) : null
  return db.$transaction(
    async (tx) => {
      const r = await tx.shopOrder.updateMany({ where: { id: orderId, payment: 'Pending' }, data: { payment: 'Failed' } })
      if (!r.count) return false
      const units = await restockOrder(tx, orderId)
      await releaseDiscounts(tx, orderId)
      await tx.shopPayment.updateMany({
        where: { orderId, status: { notIn: ['succeeded', 'refunded', 'partially_refunded'] } },
        data: { status: opts.status, failureMessage: message },
      })
      const head = opts.reason ?? (opts.status === 'canceled' ? 'Payment cancelled' : 'Payment failed')
      const parts = [head]
      if (message) parts.push(message)
      parts.push(units ? `${plural(units, 'item')} restocked` : 'nothing to restock')
      await tx.shopOrderEvent.create({ data: { orderId, kind: 'status', message: clip(parts.join(' · '), EVENT_MAX) } })
      return true
    },
    { timeout: 15_000, maxWait: 5_000 },
  )
}

/** Put a failed order's pieces back in a bag (only into an empty bag, so a repeat call adds nothing). Lines whose
    product or variant is gone are skipped; the order's code goes back on the bag when something was added. */
export async function restoreBag(db: Db, orderId: number, cartId: number): Promise<boolean> {
  const existing = await db.cartLine.findFirst({ where: { cartId }, select: { id: true } })
  if (existing) return false
  const [items, order] = await Promise.all([
    db.shopOrderItem.findMany({ where: { orderId }, orderBy: { position: 'asc' }, select: { productId: true, sku: true, qty: true } }),
    db.shopOrder.findUnique({ where: { id: orderId }, select: { discountCode: true } }),
  ])
  const wanted = items.filter((i) => i.productId && i.qty > 0)
  if (!wanted.length) return false
  const variants = await db.variant.findMany({ where: { id: { in: [...new Set(wanted.map((i) => i.sku))] } }, select: { id: true, productId: true } })
  const byId = new Map(variants.map((v) => [v.id, v]))
  const seen = new Set<string>()
  const data: Prisma.CartLineCreateManyInput[] = []
  for (const it of wanted) {
    const v = byId.get(it.sku)
    if (!v || seen.has(v.id)) continue
    seen.add(v.id)
    data.push({ cartId, productId: v.productId, variantId: v.id, qty: it.qty })
  }
  if (!data.length) return false
  const made = await db.cartLine.createMany({ data, skipDuplicates: true })
  const added = made.count > 0
  if (added && order?.discountCode) await db.cart.update({ where: { id: cartId }, data: { discountCode: order.discountCode } })
  return added
}

// ─── Refunds ────────────────────────────────────────────────────────────────

/** Record a refund (cents) on the order's provider payment. */
export async function recordRefund(db: Db, orderId: number, amountCents: number): Promise<void> {
  const p = await db.shopPayment.findFirst({
    where: { orderId, status: { in: ['succeeded', 'partially_refunded', 'refunded'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amountCents: true, refundedCents: true },
  })
  if (!p) return
  const refundedCents = Math.min(p.amountCents, p.refundedCents + amountCents)
  await db.shopPayment.update({
    where: { id: p.id },
    data: { refundedCents, status: refundedCents >= p.amountCents ? 'refunded' : 'partially_refunded' },
  })
}

/** Give money back through the provider the order was paid with, then record it on the payment row.
    Stripe errors surface as 502 PAYMENT_PROVIDER_ERROR with Stripe's message, before anything is marked refunded.
    `key` makes the call idempotent (a retried admin action never refunds twice).
    The amount is capped at what is left on the payment (per-line rounding of returns can add up to a few cents over
    the total). Returns the cents given back. */
export async function refundOrderPayment(
  db: Db,
  order: { id: number | string; paymentProvider: string; currency: string },
  amountCents: number,
  key: string,
): Promise<number> {
  const amount = Math.round(amountCents)
  if (!(amount > 0)) return 0
  const orderId = Number(order.id)
  const p = await db.shopPayment.findFirst({
    where: { orderId, provider: order.paymentProvider },
    orderBy: { createdAt: 'desc' },
    select: { providerRef: true, amountCents: true, refundedCents: true },
  })
  const left = p ? Math.max(0, p.amountCents - p.refundedCents) : amount
  const give = Math.min(amount, left)
  if (!(give > 0)) return 0
  if (order.paymentProvider === 'stripe') {
    if (!p?.providerRef) return give // nothing was charged through Stripe (e.g. a free order)
    await getProvider('stripe').refund({ ref: p.providerRef, amountCents: give, currency: order.currency, idempotencyKey: key })
  }
  if (p) await recordRefund(db, orderId, give)
  return give
}
