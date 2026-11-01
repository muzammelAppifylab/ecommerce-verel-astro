/* Trigger helpers (port of VAREL worker/lib/email/triggers.ts, WP-22): build the documented variables from database
   rows and call sendTemplateImpl. Callers use one line, AFTER their transaction commits, with `requestUrl: c.req.url`
   from a route and nothing from a job. Every helper never throws.

   Absorbs VAREL lib/payments/lifecycle.ts `sendOrderConfirmation` (adds `paymentMethod`): all four order templates use
   `orderVars`, so account holders get their account order link and a zero tax prints as empty (VAREL's confirmation
   used the guest link and printed `$0`). Money columns are cents here; amounts are formatted in the order currency. */
import type { Db } from '../db'
import { money } from '../money'
import { variantMeta } from '../variant-options'
import type { EmailTemplateKey } from './defaults'
import { loadEmailSettings, originOf, sendTemplateImpl, staffAlertAddress, type EmailVarRow, type EmailVars } from './send'

/** "$148", "€24.60", "DKK 148": whole amounts without decimals (F4 `money`), from cents. */
export const emailMoney = (cents: number, currency = 'USD'): string => money(Math.round(cents) / 100, currency || 'USD')

const firstWord = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? ''
const str = (v: unknown) => (typeof v === 'string' ? v : '')

type Address = { name?: string; line1?: string; line2?: string | null; city?: string; zip?: string; country?: string }

const ORDER_SELECT = {
  id: true,
  number: true,
  email: true,
  userId: true,
  currency: true,
  address: true,
  subtotalCents: true,
  discountCents: true,
  shippingCents: true,
  taxCents: true,
  totalCents: true,
  pricesIncludeTax: true,
  method: true,
  carrier: true,
  tracking: true,
  trackingUrl: true,
  cardBrand: true,
  cardLast4: true,
  items: {
    orderBy: { position: 'asc' },
    take: 100,
    select: { id: true, name: true, color: true, size: true, options: true, qty: true, priceCents: true, discountCents: true, digital: true },
  },
  user: { select: { customerProfile: { select: { firstName: true } } } },
} as const

async function loadOrder(db: Db, orderId: number) {
  return db.shopOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT })
}
export type EmailOrderRow = NonNullable<Awaited<ReturnType<typeof loadOrder>>>

/** Account order page for customers with an account, the confirmation page (with email) for guests. */
export const orderUrlOf = (origin: string, o: { number: string; email: string; userId: number | null }) =>
  !origin
    ? ''
    : o.userId
      ? `${origin}/account/orders/${encodeURIComponent(o.number)}/`
      : `${origin}/order/${encodeURIComponent(o.number)}/confirmation/?email=${encodeURIComponent(o.email)}`

/** "Visa ending 4242" when the card is known (VAREL `cardLabel`). */
export function paymentMethodOf(brand: string | null | undefined, last4: string | null | undefined): string {
  if (!last4) return ''
  const b = (brand ?? '').trim()
  const name = b ? (b.toLowerCase() === 'amex' ? 'American Express' : b.charAt(0).toUpperCase() + b.slice(1)) : 'Card'
  return `${name} ending ${last4}`
}

/** One-line shipping address, empty when there is none (digital orders). */
export function addressLine(raw: unknown): string {
  const a = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Address
  if (!str(a.line1)) return ''
  return [str(a.name), str(a.line1), str(a.line2), [str(a.zip), str(a.city)].filter(Boolean).join(' '), str(a.country)].filter(Boolean).join(', ')
}

/** The shared order variables: firstName, orderNumber, orderUrl, items, subtotal, discount, shipping, tax, total… */
export function orderVars(o: EmailOrderRow, origin: string): EmailVars {
  const cur = o.currency || 'USD'
  const m = (cents: number) => emailMoney(cents, cur)
  const addr = (o.address && typeof o.address === 'object' && !Array.isArray(o.address) ? o.address : null) as Address | null
  return {
    firstName: o.user?.customerProfile?.firstName || firstWord(str(addr?.name)),
    orderNumber: o.number,
    orderUrl: orderUrlOf(origin, o),
    items: o.items.map((i) => ({
      name: i.name,
      meta: variantMeta(i),
      qty: i.qty,
      total: m(i.priceCents * i.qty - i.discountCents),
    })),
    subtotal: m(o.subtotalCents),
    discount: o.discountCents > 0 ? `−${m(o.discountCents)}` : '',
    shipping: o.shippingCents > 0 ? m(o.shippingCents) : 'Free',
    tax: o.taxCents > 0 ? m(o.taxCents) : '',
    ...(o.pricesIncludeTax ? { taxLabel: 'Includes tax' } : {}),
    total: m(o.totalCents),
    method: o.method,
    paymentMethod: paymentMethodOf(o.cardBrand, o.cardLast4),
    shippingAddress: addressLine(o.address),
    carrier: o.carrier ?? '',
    trackingNumber: o.tracking ?? '',
    trackingUrl: o.trackingUrl ?? '',
  }
}

export type OrderEmailKey = Extract<EmailTemplateKey, 'order_confirmation' | 'order_shipped' | 'order_delivered' | 'order_refunded'>

export interface OrderEmailOptions {
  requestUrl?: string
  /** order_refunded: the amount given back, in cents (default: the order total). */
  refundAmountCents?: number
  /** Extra variables (caller wins). */
  vars?: EmailVars
}

/** order_confirmation, order_shipped, order_delivered, order_refunded for one order. */
export async function sendOrderEmail(db: Db, orderId: number, key: OrderEmailKey, opts: OrderEmailOptions = {}): Promise<void> {
  try {
    const o = await loadOrder(db, orderId)
    if (!o) return
    const s = await loadEmailSettings(db)
    const origin = originOf(opts.requestUrl)
    const vars: EmailVars = { ...orderVars(o, origin), returnWindowDays: s.returnWindowDays, returnsUrl: origin ? `${origin}/returns/` : '' }
    if (key === 'order_refunded') vars.refundAmount = emailMoney(opts.refundAmountCents ?? o.totalCents, o.currency || 'USD')
    await sendTemplateImpl(db, key, o.email, { ...vars, ...(opts.vars ?? {}) }, { related: { type: 'order', id: String(o.id) }, requestUrl: opts.requestUrl })
  } catch (e) {
    console.error(`[email] ${key} for order ${orderId} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The word a return status reads as in the email (`Rejected` → declined, `Requested` → reopened). */
export const returnStatusLabel = (status: string) => (status === 'Rejected' ? 'declined' : status === 'Requested' ? 'reopened' : status.toLowerCase())

/** return_update after a return changes status. `refundAmountCents` for refunded returns. */
export async function sendReturnUpdate(db: Db, returnId: number, opts: { requestUrl?: string; refundAmountCents?: number } = {}): Promise<void> {
  try {
    const r = await db.returnRequest.findUnique({ where: { id: returnId }, select: { id: true, orderId: true, email: true, status: true, items: true, note: true } })
    if (!r) return
    const o = await loadOrder(db, r.orderId)
    if (!o) return
    const cur = o.currency || 'USD'
    const origin = originOf(opts.requestUrl)
    const lines = Array.isArray(r.items) ? (r.items as { lineId?: string | number; qty?: number }[]).slice(0, 100) : []
    const items: EmailVarRow[] = lines.flatMap((it) => {
      const line = o.items.find((l) => String(l.id) === String(it?.lineId))
      return line ? [{ name: line.name, meta: variantMeta(line), qty: typeof it.qty === 'number' ? it.qty : line.qty, total: '' }] : []
    })
    const status = r.status
    await sendTemplateImpl(
      db,
      'return_update',
      r.email || o.email,
      {
        ...orderVars(o, origin),
        items,
        returnStatus: returnStatusLabel(status),
        approved: status === 'Approved',
        received: status === 'Received',
        refunded: status === 'Refunded',
        rejected: status === 'Rejected',
        requested: status === 'Requested',
        refundAmount: opts.refundAmountCents != null ? emailMoney(opts.refundAmountCents, cur) : '',
        note: r.note ?? '',
      },
      { related: { type: 'return', id: String(r.id) }, requestUrl: opts.requestUrl },
    )
  } catch (e) {
    console.error(`[email] return_update for ${returnId} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The variants whose stock this order took from above the threshold to at or below it. */
export function crossedThreshold<V extends { id: string; inventory: number | null }>(variants: V[], lines: { variantId: string; qty: number }[], threshold: number): V[] {
  return variants.filter((v) => {
    if (v.inventory == null) return false
    const bought = lines.filter((l) => l.variantId === v.id).reduce((a, l) => a + l.qty, 0)
    const now = v.inventory
    return now <= threshold && now + bought > threshold
  })
}

/**
 * low_stock_alert after checkout: one email listing every variant this order took from above the low-stock threshold
 * to at or below it. Call it after the order transaction commits with the purchased (physical) lines.
 */
export async function notifyLowStock(
  db: Db,
  order: { id: number; number: string },
  lines: { variantId: string; qty: number }[],
  opts: { requestUrl?: string } = {},
): Promise<void> {
  try {
    if (!lines.length) return
    const s = await loadEmailSettings(db)
    const threshold = s.lowStockThreshold
    const ids = [...new Set(lines.map((l) => l.variantId))].slice(0, 100)
    const variants = await db.variant.findMany({
      where: { id: { in: ids }, inventory: { not: null } },
      select: { id: true, color: true, size: true, options: true, inventory: true, product: { select: { name: true } } },
      take: 100,
    })
    const crossed = crossedThreshold(variants, lines, threshold)
    if (!crossed.length) return
    const origin = originOf(opts.requestUrl)
    await sendTemplateImpl(
      db,
      'low_stock_alert',
      staffAlertAddress(s),
      {
        orderNumber: order.number,
        threshold,
        items: crossed.map((v) => ({ name: v.product.name, meta: variantMeta(v), sku: v.id, stock: v.inventory ?? 0 })),
        inventoryUrl: origin ? `${origin}/dashboard/inventory` : '',
      },
      { related: { type: 'order', id: String(order.id) }, requestUrl: opts.requestUrl },
    )
  } catch (e) {
    console.error(`[email] low_stock_alert failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
