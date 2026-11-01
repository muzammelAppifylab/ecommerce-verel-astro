/* Abandoned bags (port of VAREL worker/lib/abandoned.ts; docs/PHASE2-3.md §7): who gets a reminder, the reminder
   itself, and the signed recovery link.
   A bag is "abandoned" when it has lines, a contact email (Cart.email from checkout, else the account email),
   no order placed since its newest line, and no activity for Setting.abandonedCartHours.
   Each bag gets one reminder for its contents: Cart.reminderSentAt is claimed with a conditional update
   before sending, so overlapping job runs or a double click never send twice. New pieces added after a
   reminder make the bag eligible again later (a bag row is reused after checkout).
   The reminder is sent through the F3 contract `sendTemplate` (WP-22 implements it: email outbox + job). */
import { sign, verify } from 'hono/jwt'
import type { Prisma } from '../../generated/prisma/client'
import type { Db } from './db'
import { fromCents, money, round2 } from './money'
import { cartInclude, serializeLine } from './cart'
import { sendTemplate } from './contracts'
import { splitName } from './serializers'
import { variantMeta } from './variant-options'

const RECOVER_TTL_S = 30 * 24 * 60 * 60
const HOUR = 60 * 60 * 1000
/** Most bags looked at per run / admin page (bounded query). */
export const ABANDONED_SCAN_LIMIT = 100

export const abandonedInclude = {
  ...cartInclude,
  user: { select: { id: true, email: true, name: true, status: true, customerProfile: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.CartInclude

export type AbandonedRow = Prisma.CartGetPayload<{ include: typeof abandonedInclude }>

/** Abandoned-bag settings, read straight from the settings row (independent of the settings serializer). */
export async function abandonedSettings(db: Db): Promise<{ enabled: boolean; hours: number; storeName: string; supportEmail: string; currency: string }> {
  const s = await db.setting.findUnique({
    where: { id: 1 },
    select: { abandonedCartEnabled: true, abandonedCartHours: true, storeName: true, supportEmail: true, currency: true },
  })
  return {
    enabled: s?.abandonedCartEnabled ?? false,
    hours: Math.max(1, s?.abandonedCartHours ?? 24),
    storeName: s?.storeName ?? 'VAREL',
    supportEmail: s?.supportEmail ?? '',
    currency: s?.currency ?? 'USD',
  }
}

/** The shopper's first name for the email ("" when unknown). */
export function firstNameOf(cart: Pick<AbandonedRow, 'user'>): string {
  const u = cart.user
  if (!u) return ''
  return u.customerProfile?.firstName || splitName(u.name).firstName
}

/** The address a reminder goes to: the email captured at checkout, else the account's (never a suspended or
    anonymised account). */
export function contactEmail(cart: Pick<AbandonedRow, 'email' | 'user'>): string | null {
  if (cart.email) return cart.email
  if (cart.user && cart.user.status === 'active' && !cart.user.email.endsWith('.invalid')) return cart.user.email
  return null
}

/** Last time the shopper touched the bag: the cart row (email capture, code) or its newest line. */
export function lastActivity(cart: Pick<AbandonedRow, 'updatedAt' | 'lines'>): Date {
  let t = cart.updatedAt.getTime()
  for (const l of cart.lines) t = Math.max(t, l.createdAt.getTime())
  return new Date(t)
}

const newestLine = (cart: Pick<AbandonedRow, 'lines'>) => Math.max(0, ...cart.lines.map((l) => l.createdAt.getTime()))

/** True when this bag's current contents already had a reminder. */
export function reminded(cart: Pick<AbandonedRow, 'reminderSentAt' | 'lines'>): boolean {
  return !!cart.reminderSentAt && cart.reminderSentAt.getTime() >= newestLine(cart)
}

/** True when staff dismissed this bag and the shopper has not added anything since. */
export function dismissed(cart: Pick<AbandonedRow, 'dismissedAt' | 'lines'>): boolean {
  return !!cart.dismissedAt && cart.dismissedAt.getTime() >= newestLine(cart)
}

/** Ids of bags that a newer bag from the same email address supersedes: only the newest bag per shopper is
    reminded, so one person never gets a reminder for every bag they started. */
export function supersededIds(carts: Pick<AbandonedRow, 'id' | 'email' | 'user' | 'updatedAt' | 'lines'>[]): Set<number> {
  const newest = new Map<string, { id: number; at: number }>()
  for (const c of carts) {
    const e = contactEmail(c)?.toLowerCase()
    if (!e || !c.lines.length) continue
    const at = lastActivity(c).getTime()
    const cur = newest.get(e)
    if (!cur || at > cur.at) newest.set(e, { id: c.id, at })
  }
  const out = new Set<number>()
  for (const c of carts) {
    const e = contactEmail(c)?.toLowerCase()
    if (e && c.lines.length && newest.get(e)?.id !== c.id) out.add(c.id)
  }
  return out
}

/** Bags with pieces and a contact email, most recently active first (the admin list and the job's superseded
    check); at most ABANDONED_SCAN_LIMIT. */
export async function bagsWithContact(db: Db): Promise<AbandonedRow[]> {
  const carts = await db.cart.findMany({
    where: { lines: { some: { product: { status: 'published' } } }, OR: [{ email: { not: null } }, { userId: { not: null } }] },
    include: abandonedInclude,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: ABANDONED_SCAN_LIMIT,
  })
  return carts.filter((c) => c.lines.length && contactEmail(c))
}

export function bagValue(cart: AbandonedRow): number {
  return round2(cart.lines.reduce((n, l) => n + fromCents(l.variant.priceCents * l.qty), 0))
}

/** Has the shopper placed an order since they last added to this bag? Then it is not abandoned. */
export async function orderedSince(db: Db, cart: AbandonedRow, email: string): Promise<boolean> {
  const since = new Date(newestLine(cart) || cart.createdAt.getTime())
  const or: Prisma.ShopOrderWhereInput[] = [{ email: { equals: email, mode: 'insensitive' } }]
  if (cart.userId) or.push({ userId: cart.userId })
  const hit = await db.shopOrder.findFirst({ where: { OR: or, placedAt: { gte: since } }, select: { id: true } })
  return hit != null
}

// ─── Recovery link ──────────────────────────────────────────────────────────

export async function recoveryToken(secret: string, cartId: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign({ cid: cartId, pur: 'cart-recover', iat: now, exp: now + RECOVER_TTL_S }, secret, 'HS256')
}

/** The cart id inside a valid recovery token, or null (expired, tampered, wrong purpose). */
export async function verifyRecoveryToken(secret: string, token: string): Promise<number | null> {
  try {
    const p = await verify(token, secret, 'HS256')
    return p.pur === 'cart-recover' && typeof p.cid === 'number' && Number.isInteger(p.cid) ? p.cid : null
  } catch {
    return null
  }
}

/** Where the reminder's button leads (the public recovery route restores the bag, then opens /cart/). */
export const recoveryUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, '')}/site-api/cart/recover/${token}`

// ─── Sending ────────────────────────────────────────────────────────────────

export type RemindOutcome = 'sent' | 'no-email' | 'empty' | 'ordered' | 'already-sent'

export interface RemindContext {
  db: Db
  /** The site's origin for the recovery link (config.siteUrl or the request's origin). */
  origin: string
  /** Signs the recovery link (config.jwtSecret). */
  secret: string
}

/**
 * Send the abandoned_cart email for one bag. Claims the bag first (reminderSentAt compare-and-set) so it is
 * sent at most once per contents. `force` (admin "Send reminder now") skips the already-sent check.
 */
export async function sendReminder(ctx: RemindContext, cart: AbandonedRow, opts: { force?: boolean } = {}): Promise<RemindOutcome> {
  const { db } = ctx
  const to = contactEmail(cart)
  if (!to) return 'no-email'
  if (!cart.lines.length) return 'empty'
  if (!opts.force && reminded(cart)) return 'already-sent'
  if (await orderedSince(db, cart, to)) return 'ordered'

  // Claim: only one caller wins; keep updatedAt (it is the shopper's last activity, not ours).
  const claimed = await db.cart.updateMany({
    where: { id: cart.id, reminderSentAt: cart.reminderSentAt },
    data: { reminderSentAt: new Date(), updatedAt: cart.updatedAt },
  })
  if (claimed.count !== 1) return 'already-sent'

  const settings = await abandonedSettings(db)
  const lines = cart.lines.map((l) => serializeLine(l))
  const cartUrl = recoveryUrl(ctx.origin, await recoveryToken(ctx.secret, cart.id))
  await sendTemplate(
    db,
    'abandoned_cart',
    to,
    {
      firstName: firstNameOf(cart),
      cartUrl,
      items: lines.map((l) => ({
        name: l.name,
        meta: variantMeta(l),
        qty: l.qty,
        total: money(l.total, settings.currency),
      })),
      itemCount: lines.reduce((n, l) => n + l.qty, 0),
      subtotal: money(bagValue(cart), settings.currency),
      storeName: settings.storeName,
      supportEmail: settings.supportEmail,
    },
    { related: { type: 'cart', id: String(cart.id) }, locale: cart.locale ?? undefined },
  )
  return 'sent'
}

/** Bags due a reminder now (scheduled job). Bounded per run; the rest are picked up 15 minutes later. */
export async function dueCarts(db: Db, hours: number, now = new Date(), take = 50): Promise<AbandonedRow[]> {
  const cutoff = new Date(now.getTime() - hours * HOUR)
  // All bags with a contact, so a newer bag (even one not idle yet) supersedes an older one from the same shopper.
  const all = await bagsWithContact(db)
  const older = supersededIds(all)
  return all
    .filter((c) => lastActivity(c) < cutoff && !reminded(c) && !dismissed(c) && !older.has(c.id))
    .sort((a, b) => lastActivity(a).getTime() - lastActivity(b).getTime())
    .slice(0, take)
}
