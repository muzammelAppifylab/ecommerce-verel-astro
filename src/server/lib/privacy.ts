/* Customer data: export (GDPR access/portability) and deletion by anonymisation (port of VAREL worker/lib/privacy.ts;
   docs/PHASE2-3.md §9, docs/API.md "Data and privacy"). Shared by the customer endpoints (/site-api/account/export,
   /site-api/account/delete) and the admin ones (/site-api/manage/customers/:id/export, DELETE).
   PLAN.md D5: the account itself (`users`, password, sessions) belongs to the template's auth. `anonymiseCustomer`
   scrubs the SHOP data held about the person; the account row is removed or suspended by the platform's own
   delete-account / user-admin flow, never written here. */
import type { Db } from './db'
import { fromCents } from './money'
import { normEmail } from './format'
import { ownedBy } from './orders'
import { orderInclude, serializeAddress, serializeOrder, splitName } from './serializers'

export const DELETED_NAME = 'Deleted customer'
export const deletedEmail = (id: number | string) => `deleted-${id}@varel.invalid`

/** The account fields these helpers read (template `users`). */
export interface PrivacyUser {
  id: number
  email: string
  name: string
  createdAt: Date
  updatedAt: Date
}

/** "mira@studio.dk" → "m***@s***.dk": enough to recognise an order in the books, not enough to contact anyone. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = normEmail(email).split('@')
  const dot = domain.lastIndexOf('.')
  const host = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  return `${local.slice(0, 1) || 'x'}***@${host.slice(0, 1) || 'x'}***${tld}`
}

/** Most rows per section of an export (a person's own history; keeps the request bounded). */
const EXPORT_LIMIT = 500

/** Everything we hold about one account, as a plain JSON document. */
export async function exportUserData(db: Db, user: PrivacyUser, roles: string[] = []) {
  const email = normEmail(user.email)
  const [profile, addresses, orders, reviews, wishlist, subscriber, returns, messages] = await Promise.all([
    db.customerProfile.findUnique({ where: { userId: user.id } }),
    db.address.findMany({ where: { userId: user.id }, orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }], take: EXPORT_LIMIT }),
    db.shopOrder.findMany({ where: ownedBy(user), include: orderInclude, orderBy: { placedAt: 'desc' }, take: EXPORT_LIMIT }),
    db.review.findMany({
      where: { OR: [{ userId: user.id }, { email: { equals: email, mode: 'insensitive' } }] },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
    }),
    db.wishlistItem.findMany({
      where: { userId: user.id },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
    }),
    db.newsletterSubscriber.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
    db.returnRequest.findMany({
      where: { order: ownedBy(user) },
      include: { order: { select: { number: true } } },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
    }),
    db.contactMessage.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: EXPORT_LIMIT }),
  ])
  const names = profile && (profile.firstName || profile.lastName) ? profile : splitName(user.name)
  return {
    exportedAt: new Date().toISOString(),
    format: 'varel-customer-export/1',
    profile: {
      id: String(user.id),
      firstName: names.firstName,
      lastName: names.lastName,
      email: user.email,
      phone: profile?.phone ?? null,
      locale: profile?.locale ?? null,
      roles,
      createdAt: user.createdAt.toISOString(),
      updatedAt: (profile && profile.updatedAt > user.updatedAt ? profile.updatedAt : user.updatedAt).toISOString(),
    },
    newsletter: {
      subscribed: (profile?.marketingOptIn ?? false) || subscriber != null,
      since: subscriber?.createdAt.toISOString() ?? null,
      source: subscriber?.source ?? null,
    },
    addresses: addresses.map(serializeAddress),
    orders: orders.map((o) => serializeOrder(o)),
    returns: returns.map((r) => ({
      orderNumber: r.order.number,
      status: r.status,
      items: r.items,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
    reviews: reviews.map((r) => ({
      product: r.product.name,
      productSlug: r.product.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      status: r.status,
      verifiedPurchase: r.verifiedPurchase,
      createdAt: r.createdAt.toISOString(),
    })),
    wishlist: wishlist.map((w) => ({ product: w.product.name, productSlug: w.product.id, addedAt: w.createdAt.toISOString() })),
    messages: messages.map((m) => ({ subject: m.subject, order: m.order, message: m.message, createdAt: m.createdAt.toISOString() })),
    totals: {
      orders: orders.length,
      spent: Math.round(orders.filter((o) => o.payment === 'Paid').reduce((n, o) => n + fromCents(o.totalCents), 0) * 100) / 100,
    },
  }
}

export const exportFilename = (user: Pick<PrivacyUser, 'id'>) => `varel-data-${user.id}-${new Date().toISOString().slice(0, 10)}.json`

/** Anonymise a customer's shop data in one transaction. Orders, returns and redemptions stay for accounting with the
    email masked; personal data (addresses, bag, wishlist, newsletter, profile, the guest visitor) is deleted;
    reviews and messages keep their text under "Deleted customer". The `users` row is left to the platform. */
export async function anonymiseCustomer(db: Db, user: Pick<PrivacyUser, 'id' | 'email'>, opts: { visitorId?: string } = {}): Promise<void> {
  const email = normEmail(user.email)
  const masked = maskEmail(email)
  const byEmail = { equals: email, mode: 'insensitive' as const }
  const run = async (tx: Db) => {
    const orders = ownedBy(user)
    await tx.returnRequest.updateMany({ where: { order: orders }, data: { email: masked } })
    await tx.shopOrder.updateMany({ where: orders, data: { email: masked, phone: null } })
    await tx.discountRedemption.updateMany({ where: { OR: [{ userId: user.id }, { email: byEmail }] }, data: { email: masked } })
    await tx.review.updateMany({
      where: { OR: [{ userId: user.id }, { email: byEmail }] },
      data: { name: DELETED_NAME, email: deletedEmail(user.id) },
    })
    await tx.contactMessage.updateMany({ where: { email: byEmail }, data: { name: DELETED_NAME, email: masked } })
    await tx.cart.updateMany({ where: { email: byEmail }, data: { email: null } })
    await tx.analyticsEvent.updateMany({ where: { userId: user.id }, data: { userId: null } })
    await tx.address.deleteMany({ where: { userId: user.id } })
    await tx.wishlistItem.deleteMany({ where: { userId: user.id } })
    await tx.cart.deleteMany({ where: { userId: user.id } })
    await tx.newsletterSubscriber.deleteMany({ where: { email: byEmail } })
    await tx.customerProfile.deleteMany({ where: { userId: user.id } })
    if (opts.visitorId) await tx.visitor.deleteMany({ where: { id: opts.visitorId } })
  }
  const client = db as { $transaction?: (fn: (tx: Db) => Promise<void>) => Promise<void> }
  if (typeof client.$transaction === 'function') await client.$transaction(run)
  else await run(db)
}
