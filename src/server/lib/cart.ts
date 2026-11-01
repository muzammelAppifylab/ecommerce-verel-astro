/* Bag + wishlist ownership, serialization and stock rules (port of VAREL worker/lib/cart.ts).
   A bag belongs to the user when signed in (template viewer, `users.id`), otherwise to the guest visitor
   (`visitor_id` cookie, ./visitor.ts; VAREL's `varel_sid` Session). Money: cents in the database, currency units
   in the contract and the promotions engine. */
import type { Context } from 'hono'
import type { Prisma } from '../../generated/prisma/client'
import type { Viewer } from '../../platform/types'
import type { Db, DbClient } from './db'
import { HttpError, notFound } from './errors'
import { fromCents, round2 } from './money'
import { categoryName, photoOf } from './serializers'
import { EN_LOC, colorLabel, loadCatalogTr, locOf, tr, type CatalogTr, type Loc } from './i18n/localize'
import { computeTotals, shippingValue } from './totals'
import { evaluatePromotions } from './discounts'
import { engineLinesOf, loadAutomaticDiscounts, loadCodeDiscount, loadCustomer, type LoadedCode } from './promotions-loader'
import type { EngineCustomer, EngineDiscount, EngineResult } from './promotions-types'
import { getSettings, taxFor, totalsConfig, type StoreSettings, type TaxConfig } from './settings'
import { ensureVisitor, visitorIdOf } from './visitor'
import type * as T from './contract-types'
import { optionValues, variantMeta } from './variant-options'

export type Owner = { userId: number; visitorId?: undefined } | { visitorId: string; userId?: undefined }

/** The signed-in user's id from the template viewer (`withViewer`), or null for a guest. */
export function viewerUserId(c: Context): number | null {
  const viewer = (c.get as (name: string) => unknown)('viewer') as Viewer | undefined
  return viewer?.state === 'user' && typeof viewer.id === 'number' ? viewer.id : null
}

/** Who owns the bag/wishlist of this request: the signed-in user, else the guest visitor (row ensured). */
export async function ownerOf(c: Context): Promise<Owner> {
  const userId = viewerUserId(c)
  if (userId != null) return { userId }
  const visitorId = visitorIdOf(c)
  await ensureVisitor((c.get as (name: string) => unknown)('db') as Db, visitorId)
  return { visitorId }
}

const ownerWhere = (owner: Owner) => (owner.userId != null ? { userId: owner.userId } : { visitorId: owner.visitorId! })

/** Most lines a bag holds (and reads): bounded query, AGENTS.md. */
export const BAG_LINE_LIMIT = 100

/** The bag's lines with exactly what pricing, serializing, stock checks and reminders read (explicit select). */
export const cartLineSelect = {
  id: true,
  qty: true,
  productId: true,
  variantId: true,
  createdAt: true,
  variant: { select: { id: true, color: true, size: true, options: true, priceCents: true, inventory: true } },
  product: {
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      allowBackorder: true,
      categoryId: true,
      departmentId: true,
      category: { select: { id: true, name: true } },
      images: { orderBy: { position: 'asc' }, take: 1, select: { src: true, credit: true, creditHref: true } },
    },
  },
} satisfies Prisma.CartLineSelect

export const cartInclude = {
  lines: {
    // Draft and archived products drop out of the bag (they stay in the table until removed).
    where: { product: { status: 'published' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: BAG_LINE_LIMIT,
    select: cartLineSelect,
  },
} satisfies Prisma.CartInclude

export type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>

export async function getOrCreateCart(db: Db, owner: Owner): Promise<CartRow> {
  const where = ownerWhere(owner)
  const existing = await db.cart.findUnique({ where, include: cartInclude })
  if (existing) return existing
  // A guest bag hangs off its Visitor row (FK): make sure it exists before creating the bag.
  if (owner.visitorId != null) await ensureVisitor(db, owner.visitorId)
  return db.cart.upsert({ where, create: where, update: {}, include: cartInclude })
}

export async function reloadCart(db: Db, cartId: number): Promise<CartRow> {
  return db.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude })
}

/** `loc` + `ctr`: request language and content overlays (name, category and colour labels). */
export function serializeLine(l: CartRow['lines'][number], discount = 0, loc: Loc = EN_LOC, ctr?: CatalogTr): T.CartLine {
  const p = l.product
  const unit = fromCents(l.variant.priceCents)
  const name = tr(ctr?.product, p.id, 'name', p.name)
  const categoryLabel = categoryName(ctr, p.category)
  return {
    lineId: String(l.id),
    productId: p.id,
    name,
    category: p.category.name,
    categoryLabel,
    colorLabel: colorLabel(ctr, l.variant.color),
    type: p.type as T.ProductType,
    sku: l.variant.id,
    color: l.variant.color,
    size: l.variant.size,
    options: optionValues(l.variant.options),
    qty: l.qty,
    unit,
    total: fromCents(l.variant.priceCents * l.qty),
    inventory: l.variant.inventory,
    digital: p.type === 'digital',
    image: photoOf(p.images[0]),
    alt: loc.t('cart.lineAlt', { name, category: categoryLabel }, '{name} — {category}'),
    discount,
    backorder: p.allowBackorder,
  }
}

export interface PricedBag {
  lines: T.CartLine[]
  totals: T.Totals
  result: EngineResult
  /** The discount behind the code that was evaluated (null when none or unknown). */
  code: LoadedCode | null
  codeEntered: string | null
  customer: EngineCustomer
  discounts: EngineDiscount[]
  /** What the applied free shipping saved on this bag (the selected rate, or 0 when none applied or it ships free anyway). */
  shippingSaved: number
  settings: StoreSettings
  /** The tax that applied (the shipping country's rate, or the default). */
  tax: TaxConfig
}

export interface PriceOptions {
  stage?: 'cart' | 'checkout'
  /** Rate of the selected shipping method (0 when none chosen yet). */
  shippingRate?: number
  /** Price with this code instead of the one stored on the bag (POST /cart/discount). */
  code?: string | null
  /** Checkout email (at the cart stage the signed-in account's email is used). */
  email?: string | null
  /** Shipping country: picks its TaxRate (exact country match); the default rate when unknown. */
  country?: string | null
  now?: Date
  /** Request language: line names, discount labels and messages, totals labels. Default English source text. */
  loc?: Loc
}

/** Run the promotions engine on a bag: the one place bag money is computed (cart, totals, checkout). */
export async function priceBag(db: Db, cart: CartRow, opts: PriceOptions = {}): Promise<PricedBag> {
  const now = opts.now ?? new Date()
  const loc = opts.loc ?? EN_LOC
  const codeEntered = (opts.code !== undefined ? opts.code : cart.discountCode)?.trim().toUpperCase() || null
  const [settings, code, automatic, customer, ctr] = await Promise.all([
    getSettings(db),
    loadCodeDiscount(db, codeEntered, loc),
    loadAutomaticDiscounts(db, now, loc),
    loadCustomer(db, { userId: cart.userId, email: opts.email ?? null }),
    loadCatalogTr(
      db,
      loc,
      cart.lines.map((l) => ({ id: l.product.id, categoryId: l.product.categoryId, departmentId: l.product.departmentId, variants: [l.variant] })),
    ),
  ])
  const tax = await taxFor(db, settings, opts.country)
  const config = totalsConfig(settings, tax)
  const result = evaluatePromotions({
    lines: engineLinesOf(cart.lines),
    code: code?.discount ?? null,
    codeEntered,
    automatic,
    customer,
    stage: opts.stage ?? 'cart',
    shippingRate: opts.shippingRate ?? 0,
    freeThreshold: config.freeThreshold,
    now,
    ...(loc.locale !== 'en' ? { t: loc.t } : {}),
  })
  const lines = cart.lines.map((l) => serializeLine(l, result.lineDiscounts[String(l.id)] ?? 0, loc, ctr))
  // Free shipping saves the rate only when the bag wouldn't ship free anyway after its merchandise discounts.
  const shippingSaved = result.freeShipping ? shippingValue(lines, opts.shippingRate ?? 0, config.freeThreshold, result.discountTotal) : 0
  const discounts = [...automatic, ...(code ? [code.discount] : [])]
  const totals = computeTotals(lines, {
    promotions: result,
    discounts,
    shippingRate: opts.shippingRate ?? 0,
    ...config,
    ...(loc.locale !== 'en' ? { t: loc.t } : {}),
  })
  return { lines, totals, result, code, codeEntered, customer, discounts, shippingSaved, settings, tax }
}

/** Order columns snapshotted from a priced bag: currency, tax mode and the rate that applied. */
export const orderSnapshot = (priced: PricedBag) => ({
  currency: priced.settings.currency,
  pricesIncludeTax: priced.tax.pricesIncludeTax,
  taxRate: priced.tax.rate,
})

/** Serialize a bag. `shippingRate` is the chosen method's rate (0 when none chosen yet); `country` picks the tax rate. */
export async function serializeCart(db: Db, cart: CartRow, shippingRate = 0, country?: string | null, loc?: Loc): Promise<T.Cart> {
  return cartOf(cart, await priceBag(db, cart, { shippingRate, country, loc }))
}

export function cartOf(cart: CartRow, priced: PricedBag): T.Cart {
  const stored = priced.codeEntered
  return {
    id: String(cart.id),
    lines: priced.lines,
    discountCode: stored,
    discountNote: stored ? (priced.code?.discount.label ?? null) : null,
    discountError: stored ? priced.result.rejected : null,
    totals: priced.totals,
  }
}

/** The request's bag, serialized in the request language (routes behind withViewer + withDb). */
export async function cartFor(c: Context): Promise<T.Cart> {
  const db = (c.get as (name: string) => unknown)('db') as Db
  return serializeCart(db, await getOrCreateCart(db, await ownerOf(c)), 0, undefined, await locOf(c))
}

// ─── Stock ──────────────────────────────────────────────────────────────────

type StockVariant = { id: string; inventory: number | null; color: string | null; size: string | null; options: Prisma.JsonValue }

const variantName = (name: string, v: Pick<StockVariant, 'color' | 'size' | 'options'>) => {
  const opts = variantMeta(v).replaceAll(' · ', ' / ')
  return opts ? `${name} in ${opts}` : name
}

/** Rejects (409) beyond inventory, unless the product is sold past zero stock (`allowBackorder`). */
export function assertStock(productName: string, v: StockVariant, qty: number, allowBackorder = false): void {
  if (v.inventory == null || allowBackorder) return
  if (v.inventory <= 0) throw new HttpError(409, 'OUT_OF_STOCK', `${variantName(productName, v)} is sold out`)
  if (qty > v.inventory) {
    throw new HttpError(
      409,
      'OUT_OF_STOCK',
      `Only ${v.inventory} left of ${variantName(productName, v)}. Lower the quantity to continue`,
    )
  }
}

/** Take the bag's units out of stock inside the order transaction (409 OUT_OF_STOCK when another order got there
    first). Backorder products may go below zero. */
export async function reserveStock(tx: Db, lines: CartRow['lines']): Promise<void> {
  for (const line of lines) {
    if (line.variant.inventory == null) continue
    const backorder = line.product.allowBackorder
    const updated = await tx.variant.updateMany({
      where: { id: line.variant.id, ...(backorder ? {} : { inventory: { gte: line.qty } }) },
      data: { inventory: { decrement: line.qty } },
    })
    if (updated.count === 0) {
      const v = await tx.variant.findUnique({ where: { id: line.variant.id }, select: { inventory: true } })
      const left = v?.inventory ?? 0
      const label = variantName(line.product.name, line.variant)
      throw new HttpError(
        409,
        'OUT_OF_STOCK',
        left > 0 ? `Only ${left} left of ${label}. Update your bag to continue` : `${label} has just sold out. Remove it from your bag to continue`,
      )
    }
  }
}

/** The variant a shopper chose: by id when given (exact, covers custom options), else by colour + size, preferring
    one in stock (port of VARELStore.variantOf). */
export function pickVariant<V extends { id: string; color: string | null; size: string | null; inventory: number | null }>(
  variants: V[],
  color?: string | null,
  size?: string | null,
  variantId?: string | null,
): V | undefined {
  if (variantId) return variants.find((v) => v.id === variantId)
  const matches = variants.filter((v) => (color == null || v.color === color) && (size == null || v.size === size))
  return matches.find((v) => v.inventory == null || v.inventory > 0) ?? matches[0]
}

/** What the shopper picked: an exact variant id, or colour + size (older clients). */
export interface LinePick {
  variantId?: string | null
  color?: string | null
  size?: string | null
}

/** Add qty of a variant to a bag, merging with an identical line. Rejects (409) beyond inventory. */
export async function addLine(
  db: Db,
  cartId: number,
  productId: string,
  pick: LinePick,
  qty: number,
  opts: { clampToStock?: boolean } = {},
): Promise<void> {
  const { color, size, variantId } = pick
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, status: true, allowBackorder: true, variants: { orderBy: { position: 'asc' }, take: 100, select: { id: true, color: true, size: true, options: true, inventory: true } } },
  })
  if (!product || product.status !== 'published') throw notFound('We cannot find that product')
  const variant = pickVariant(product.variants, color ?? null, size ?? null, variantId)
  if (!variant) {
    throw new HttpError(422, 'VARIANT_UNAVAILABLE', 'That colour and size combination is not available', {
      ...(color ? { color: 'Choose another colour' } : {}),
      ...(size ? { size: 'Choose another size' } : {}),
    })
  }
  const existing = await db.cartLine.findUnique({ where: { cartId_variantId: { cartId, variantId: variant.id } }, select: { id: true, qty: true } })
  let next = (existing?.qty ?? 0) + qty
  if (opts.clampToStock && variant.inventory != null && !product.allowBackorder) next = Math.min(next, variant.inventory)
  if (next <= 0) return
  assertStock(product.name, variant, next, product.allowBackorder)
  if (existing) {
    await db.cartLine.update({ where: { id: existing.id }, data: { qty: next } })
  } else {
    // A bag holds at most BAG_LINE_LIMIT distinct pieces (bounded reads everywhere); bounded check, no count().
    const held = await db.cartLine.findMany({ where: { cartId }, select: { id: true }, take: BAG_LINE_LIMIT })
    if (held.length >= BAG_LINE_LIMIT) throw new HttpError(409, 'BAG_FULL', 'Your bag is full. Remove a piece to add another')
    await db.cartLine.create({ data: { cartId, productId: product.id, variantId: variant.id, qty: next } })
  }
}

/** Merchandise value of a bag (currency units). */
export const bagSubtotal = (cart: CartRow) => round2(cart.lines.reduce((n, l) => n + fromCents(l.variant.priceCents * l.qty), 0))

// ─── Wishlist ───────────────────────────────────────────────────────────────

/** Product ids on the owner's wishlist, oldest first (a wishlist is small; capped at 100). */
export async function wishlistIds(db: Db, owner: Owner): Promise<string[]> {
  const rows = await db.wishlistItem.findMany({
    where: ownerWhere(owner),
    orderBy: { createdAt: 'asc' },
    select: { productId: true },
    take: 100,
  })
  return rows.map((r) => r.productId)
}

// ─── Merge on sign-in ───────────────────────────────────────────────────────

/** Move the guest bag and wishlist of a visitor into the user's. Never throws (sign-in must not fail on it). */
export async function mergeGuestIntoUser(db: DbClient, visitorId: string, userId: number): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      const guestCart = await tx.cart.findUnique({ where: { visitorId }, include: { lines: { orderBy: { createdAt: 'asc' }, take: BAG_LINE_LIMIT, select: { productId: true, variantId: true, qty: true } } } })
      if (guestCart && (guestCart.lines.length || guestCart.discountCode)) {
        const userCart = await getOrCreateCart(tx, { userId })
        for (const line of guestCart.lines) {
          await addLine(tx, userCart.id, line.productId, { variantId: line.variantId }, line.qty, { clampToStock: true }).catch(
            () => undefined,
          )
        }
        if (!userCart.discountCode && guestCart.discountCode) {
          await tx.cart.update({ where: { id: userCart.id }, data: { discountCode: guestCart.discountCode } })
        }
      }
      if (guestCart) await tx.cart.delete({ where: { id: guestCart.id } })

      const guestWish = await tx.wishlistItem.findMany({ where: { visitorId }, orderBy: { createdAt: 'asc' }, take: 100 })
      for (const w of guestWish) {
        await tx.wishlistItem.upsert({
          where: { userId_productId: { userId, productId: w.productId } },
          create: { userId, productId: w.productId },
          update: {},
        })
      }
      await tx.wishlistItem.deleteMany({ where: { visitorId } })
    })
  } catch (err) {
    console.error('[varel] could not merge guest bag into account', err)
  }
}
