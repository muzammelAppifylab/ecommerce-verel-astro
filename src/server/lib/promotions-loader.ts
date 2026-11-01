/* Database side of the promotions engine (port of VAREL worker/lib/promotions-loader.ts; docs/PROMOTIONS.md):
   loads what evaluatePromotions() needs.
   - loadCodeDiscount(): the discount behind a typed code — a shared code, or one of a batch of unique codes.
   - loadAutomaticDiscounts(): automatic discounts that are switched on and in schedule.
   - loadCustomer(): paid orders, newsletter, and redemptions per discount (by account id or email).
   - engineLinesOf(): bag lines → engine lines.
   - promotionFor(): the best automatic discount to show on a product (`Product.promotion`).
   The engine works on string ids and currency units, exactly as in VAREL; the schema's integer ids and cents
   (Discount.percentOff / amountCents / maxAmountCents / minimumCents) are converted here. */
import type { Prisma } from '../../generated/prisma/client'
import type { Db } from './db'
import { fromCents, fromCentsOrNull, num } from './money'
import { lineInScope, unitValue, validity } from './discounts'
import type { EngineCustomer, EngineDiscount, EngineDiscountKind, EngineEligibility, EngineLine, EngineScope } from './promotions-types'
import { EN_LOC, loadFor, tr, type Loc } from './i18n/localize'

const withUsage = { _count: { select: { redemptions: true } } } satisfies Prisma.DiscountInclude

type DiscountRow = Prisma.DiscountGetPayload<{ include: typeof withUsage }>

const ids = (xs: (string | number)[] | null | undefined) => (xs ?? []).map(String)

/** The engine's `value`: percent off for `percent`, the amount for `fixed`, unused (0) for shipping and bxgy. */
export function discountValue(d: Pick<DiscountRow, 'kind' | 'percentOff' | 'amountCents'>): number {
  if (d.kind === 'percent') return num(d.percentOff)
  if (d.kind === 'fixed') return fromCents(d.amountCents)
  return 0
}

export function toEngineDiscount(d: DiscountRow, extra: Partial<EngineDiscount> = {}): EngineDiscount {
  return {
    id: String(d.id),
    method: d.method === 'automatic' ? 'automatic' : 'code',
    name: d.name || d.code || d.label,
    code: d.code,
    codeType: d.codeType === 'unique' ? 'unique' : 'shared',
    kind: d.kind as EngineDiscountKind,
    value: discountValue(d),
    maxAmount: fromCentsOrNull(d.maxAmountCents),
    buyQty: d.buyQty,
    getQty: d.getQty,
    getPercent: d.getPercent,
    scope: d.scope as EngineScope,
    productIds: ids(d.productIds),
    categoryIds: ids(d.categoryIds),
    departmentIds: ids(d.departmentIds),
    minimum: fromCents(d.minimumCents),
    minimumQty: d.minimumQty,
    eligibility: d.eligibility as EngineEligibility,
    customerIds: ids(d.customerIds),
    usageLimit: d.usageLimit,
    perCustomerLimit: d.perCustomerLimit,
    combinable: d.combinable,
    priority: d.priority,
    label: d.label,
    active: d.active,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    createdAt: d.createdAt,
    used: d._count.redemptions,
    ...extra,
  }
}

/** "T-Shirts" → "T-shirts", "Knitwear" → "knitwear" (sentence case inside a message). German nouns keep their case. */
const inSentence = (name: string, locale = 'en') => {
  if (locale === 'de') return name
  const lower = name.toLowerCase()
  return /^[a-z]-/.test(lower) ? lower[0]!.toUpperCase() + lower.slice(1) : lower
}

const joinWords = (xs: string[], loc: Loc = EN_LOC) =>
  xs.length <= 1 ? (xs[0] ?? '') : loc.t('list.and', { first: xs.slice(0, -1).join(', '), last: xs[xs.length - 1]! }, '{first} and {last}')

const intIds = (xs: string[]) => xs.map(Number).filter((n) => Number.isInteger(n))

/** Fill `scopeLabel` ("T-shirts", "knitwear", "the Forma Overshirt") for customer-facing messages, and overlay the
    discount's translated `name` / `label` (entity `discount`) in the request language. */
async function withScopeLabels(db: Db, ds: EngineDiscount[], loc: Loc = EN_LOC): Promise<EngineDiscount[]> {
  if (!ds.length) return ds
  const cats = [...new Set(ds.flatMap((d) => (d.scope === 'categories' ? d.categoryIds : [])))]
  const prods = [...new Set(ds.flatMap((d) => (d.scope === 'products' ? d.productIds : [])))]
  const depts = [...new Set(ds.flatMap((d) => (d.scope === 'departments' ? d.departmentIds : [])))]
  const [catRows, prodRows, deptRows, discTr, catTr, prodTr, deptTr] = await Promise.all([
    cats.length ? db.category.findMany({ where: { id: { in: intIds(cats) } }, select: { id: true, name: true } }) : [],
    prods.length ? db.product.findMany({ where: { id: { in: prods } }, select: { id: true, name: true } }) : [],
    depts.length ? db.department.findMany({ where: { id: { in: intIds(depts) } }, select: { id: true, name: true } }) : [],
    loadFor(db, loc, 'discount', ds.map((d) => d.id), ['name', 'label']),
    loadFor(db, loc, 'category', cats, ['name']),
    loadFor(db, loc, 'product', prods, ['name']),
    loadFor(db, loc, 'department', depts, ['name']),
  ])
  const name = (rows: { id: string | number; name: string }[], list: string[], m: Map<string, string>) =>
    list.flatMap((id) => {
      const r = rows.find((x) => String(x.id) === id)
      return r ? [tr(m, r.id, 'name', r.name)] : []
    })
  return ds.map((src) => {
    const d = loc.overlay ? { ...src, name: tr(discTr, src.id, 'name', src.name), label: tr(discTr, src.id, 'label', src.label) } : src
    let label: string | undefined
    if (d.scope === 'categories') label = joinWords([...new Set(name(catRows, d.categoryIds, catTr).map((n) => inSentence(n, loc.locale)))], loc)
    if (d.scope === 'products') {
      const names = name(prodRows, d.productIds, prodTr)
      label = names.length === 1 ? names[0] : names.length ? loc.t('discount.scope.selected', {}, 'the selected pieces') : undefined
    }
    if (d.scope === 'departments') {
      label = loc.t('discount.scope.fromDepts', { depts: joinWords(name(deptRows, d.departmentIds, deptTr), loc) }, 'pieces from {depts}')
    }
    return label ? { ...d, scopeLabel: label } : d
  })
}

export interface LoadedCode {
  discount: EngineDiscount
  /** Set for a unique code: the DiscountCode row. */
  uniqueCode: { id: number; code: string; usedAt: Date | null } | null
}

/** The discount behind a typed code (case-insensitive): a shared code first, then a unique code. */
export async function loadCodeDiscount(db: Db, raw: string | null | undefined, loc: Loc = EN_LOC): Promise<LoadedCode | null> {
  const code = raw?.trim().toUpperCase()
  if (!code || code.length > 64) return null
  const shared = await db.discount.findFirst({ where: { code, method: 'code' }, include: withUsage })
  if (shared && shared.codeType === 'shared') {
    return { discount: (await withScopeLabels(db, [toEngineDiscount(shared)], loc))[0]!, uniqueCode: null }
  }
  const unique = await db.discountCode.findUnique({ where: { code }, include: { discount: { include: withUsage } } })
  if (!unique || unique.discount.method !== 'code') return null
  const d = toEngineDiscount(unique.discount, { codeType: 'unique', uniqueCodeUsed: !!unique.usedAt })
  return {
    discount: (await withScopeLabels(db, [d], loc))[0]!,
    uniqueCode: { id: unique.id, code: unique.code, usedAt: unique.usedAt },
  }
}

/** Automatic discounts that are switched on and in schedule (the engine re-checks everything). A store runs a
    handful at once; capped at 100. */
export async function loadAutomaticDiscounts(db: Db, now = new Date(), loc: Loc = EN_LOC): Promise<EngineDiscount[]> {
  const rows = await db.discount.findMany({
    where: {
      method: 'automatic',
      active: true,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    include: withUsage,
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: 100,
  })
  return withScopeLabels(db, rows.map((r) => toEngineDiscount(r)), loc)
}

/** Who is buying: account (when signed in) and/or email (checkout), with their history. */
export async function loadCustomer(db: Db, who: { userId: number | null; email: string | null }): Promise<EngineCustomer> {
  let email = who.email?.trim().toLowerCase() || null
  let newsletter = false
  // History is matched by the account and by every email the customer is known by: the checkout email and, when
  // signed in, the account's email (guest orders placed under it count too).
  const emails = new Set<string>(email ? [email] : [])
  if (who.userId) {
    const u = await db.user.findUnique({
      where: { id: who.userId },
      select: { email: true, customerProfile: { select: { marketingOptIn: true } } },
    })
    if (u) {
      email ??= u.email.toLowerCase()
      emails.add(u.email.toLowerCase())
      newsletter = u.customerProfile?.marketingOptIn ?? false
    }
  }
  const match: Prisma.ShopOrderWhereInput[] = []
  if (who.userId) match.push({ userId: who.userId })
  for (const e of emails) match.push({ email: { equals: e, mode: 'insensitive' } })
  const redMatch: Prisma.DiscountRedemptionWhereInput[] = []
  if (who.userId) redMatch.push({ userId: who.userId })
  for (const e of emails) redMatch.push({ email: { equals: e, mode: 'insensitive' } })

  const [paidOrders, subscriber, redemptions] = await Promise.all([
    // Only "none" vs "some" matters (first_order): look at most at one paid order, never count them all.
    // Orders that were paid count, including ones refunded since (a refund doesn't make the next order a first one).
    match.length
      ? db.shopOrder.findMany({ where: { payment: { in: ['Paid', 'Refunded'] }, OR: match }, select: { id: true }, take: 1 }).then((r) => r.length)
      : 0,
    email ? db.newsletterSubscriber.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }) : null,
    redMatch.length ? db.discountRedemption.groupBy({ by: ['discountId'], where: { OR: redMatch }, _count: { _all: true } }) : [],
  ])
  return {
    id: who.userId == null ? null : String(who.userId),
    email,
    signedIn: !!who.userId,
    paidOrders,
    subscriber: newsletter || !!subscriber,
    redemptions: Object.fromEntries(redemptions.map((r) => [String(r.discountId), r._count._all])),
  }
}

/** Bag lines (cart include) → engine lines. */
export function engineLinesOf(
  lines: {
    id: number | string
    qty: number
    variant: { priceCents: number }
    product: { id: string; categoryId: number | string; departmentId: number | string; type: string }
  }[],
): EngineLine[] {
  return lines.map((l) => ({
    lineId: String(l.id),
    productId: l.product.id,
    categoryId: String(l.product.categoryId),
    departmentId: String(l.product.departmentId),
    unit: fromCents(l.variant.priceCents),
    qty: l.qty,
    digital: l.product.type === 'digital',
  }))
}

// ─── Product.promotion ──────────────────────────────────────────────────────

/** Automatic discounts that may be shown on product cards: no eligibility beyond everyone / signed in. */
export async function loadProductPromotions(db: Db, now = new Date(), loc: Loc = EN_LOC): Promise<EngineDiscount[]> {
  const autos = await loadAutomaticDiscounts(db, now, loc)
  return autos.filter((d) => d.eligibility === 'everyone' || d.eligibility === 'signed_in')
}

/** The best automatic discount covering a product, by value for its unit price. */
export function promotionFor(
  p: { id: string; categoryId: number | string; departmentId: number | string; price: number },
  promos: EngineDiscount[],
  now = new Date(),
): { label: string; discountId: string } | null {
  let best: { d: EngineDiscount; v: number } | null = null
  const probe: EngineLine = {
    lineId: p.id,
    productId: p.id,
    categoryId: String(p.categoryId),
    departmentId: String(p.departmentId),
    unit: p.price,
    qty: 1,
    digital: false,
  }
  const guest: EngineCustomer = { id: null, email: null, signedIn: false, paidOrders: 0, subscriber: false, redemptions: {} }
  for (const d of promos) {
    if (!lineInScope(d, probe)) continue
    // Active, in schedule and not used up (bag-size rules such as minimums don't hide the note).
    const err = validity(d, { lines: [probe], customer: guest, stage: 'cart', now })
    if (err && err !== 'DISCOUNT_MINIMUM' && err !== 'DISCOUNT_MIN_QTY') continue
    const v = unitValue(d, p.price)
    if (!best || v > best.v || (v === best.v && d.priority > best.d.priority)) best = { d, v }
  }
  return best ? { label: best.d.label, discountId: best.d.id } : null
}
