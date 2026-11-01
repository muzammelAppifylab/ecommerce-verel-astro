/* DB rows → contract shapes (port of VAREL worker/lib/serializers.ts). Derived fields follow varel-store.js exactly.
   Money columns are integer cents (`priceCents` …) and leave here in currency units (`fromCents`); numeric ids
   (departments, categories, posts, discounts, addresses, order lines) leave as strings, as in VAREL's contract.
   People: the template's `users` row + `CustomerProfile` (PLAN.md D5) replace VAREL's User. */
import type { Prisma } from '../../generated/prisma/client'
import { fromCents, fromCentsOrNull, num } from './money'
import { displayDate, monthYear } from './format'
import { summaryLabel } from './totals'
import { canCancel } from './orders'
import type { EngineDiscount } from './promotions-types'
import { promotionFor } from './promotions-loader'
import type * as T from './contract-types'
import { EN_LOC, colorLabel, tr, type CatalogTr, type Loc, type TranslationMap } from './i18n/localize'
import { optionDefs, optionValues } from './variant-options'

// ─── Includes ───────────────────────────────────────────────────────────────

/** Most images / variants read per product (a product page shows ≤ ~12 photos and ≤ ~30 variants). */
export const PRODUCT_IMAGE_LIMIT = 20
export const PRODUCT_VARIANT_LIMIT = 100

const departmentSelect = { id: true, name: true, slug: true } satisfies Prisma.DepartmentSelect
const categorySelect = { id: true, name: true, slug: true } satisfies Prisma.CategorySelect
const imageSelect = { src: true, credit: true, creditHref: true, position: true } satisfies Prisma.ProductImageSelect
const variantSelect = {
  id: true,
  color: true,
  size: true,
  swatch: true,
  options: true,
  priceCents: true,
  inventory: true,
  position: true,
} satisfies Prisma.VariantSelect

/** Explicit select for storefront products: everything serializeProduct, the listing filters and facets read,
    and nothing else (no cost, weights or package sizes; performance.md "explicit select"). */
export const productSelect = {
  id: true,
  name: true,
  brand: true,
  type: true,
  status: true,
  priceCents: true,
  compareAtCents: true,
  sku: true,
  short: true,
  description: true,
  material: true,
  care: true,
  tags: true,
  download: true,
  allowBackorder: true,
  options: true,
  featured: true,
  position: true,
  categoryPosition: true,
  ratingAvg: true,
  ratingCount: true,
  createdAt: true,
  departmentId: true,
  categoryId: true,
  department: { select: departmentSelect },
  category: { select: categorySelect },
  images: { select: imageSelect, orderBy: { position: 'asc' }, take: PRODUCT_IMAGE_LIMIT },
  variants: { select: variantSelect, orderBy: { position: 'asc' }, take: PRODUCT_VARIANT_LIMIT },
} satisfies Prisma.ProductSelect

/** The same relations as an `include` (every product scalar + the narrow relations), for callers that also need
    columns productSelect leaves out. Its rows are assignable to ProductRow. Prefer productSelect. */
export const productInclude = {
  department: { select: departmentSelect },
  category: { select: categorySelect },
  images: { select: imageSelect, orderBy: { position: 'asc' }, take: PRODUCT_IMAGE_LIMIT },
  variants: { select: variantSelect, orderBy: { position: 'asc' }, take: PRODUCT_VARIANT_LIMIT },
} satisfies Prisma.ProductInclude

/** A storefront product row (productSelect). Rows read with productInclude or a wider select fit too. */
export type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>

export const orderInclude = {
  items: { orderBy: { position: 'asc' } },
  redemptions: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { discount: { select: { method: true, name: true, label: true, kind: true } } },
  },
} satisfies Prisma.ShopOrderInclude

/** An order with its items; `redemptions` (applied discounts) when loaded with orderInclude. */
export type OrderRow = Prisma.ShopOrderGetPayload<{ include: { items: true } }> & {
  redemptions?: Prisma.ShopOrderGetPayload<{ include: typeof orderInclude }>['redemptions']
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const STOCK_LABEL: Record<T.StockState, string> = {
  in: 'In stock',
  low: 'Low stock',
  out: 'Sold out',
  digital: 'Instant download',
}

/** Stock label of a backorder product with nothing on hand. */
export const BACKORDER_LABEL = 'Made to order · ships in 2–3 weeks'

const FALLBACK_SWATCH = '#D9D9D9'

export const FALLBACK_PHOTO: T.Photo = {
  src: 'https://images.unsplash.com/photo-1633972767447-5098f0322a45',
  credit: 'Photo by Katya Azimova on Unsplash',
  creditHref: 'https://unsplash.com/@_katishna_',
}

/** Default low-stock threshold; the routes pass Setting.lowStockThreshold. */
export const LOW_STOCK = 6

export function stockOf(
  p: { type: string; variants: { inventory: number | null }[]; allowBackorder?: boolean },
  lowStock = LOW_STOCK,
): T.StockState {
  if (p.type === 'digital') return 'digital'
  const total = p.variants.reduce((n, v) => n + Math.max(0, v.inventory ?? 0), 0)
  // Backorder products stay purchasable: "in" stock, labelled made to order when nothing is on hand.
  if (!total) return p.allowBackorder ? 'in' : 'out'
  return total <= lowStock ? 'low' : 'in'
}

export function photoOf(img: { src: string; credit: string; creditHref: string } | undefined | null): T.Photo {
  return img ? { src: img.src, credit: img.credit, creditHref: img.creditHref } : FALLBACK_PHOTO
}

export function asPhoto(json: Prisma.JsonValue | null | undefined): T.Photo {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const o = json as Record<string, unknown>
    if (typeof o.src === 'string') {
      return { src: o.src, credit: String(o.credit ?? ''), creditHref: String(o.creditHref ?? '') }
    }
  }
  return FALLBACK_PHOTO
}

export function serializeVariant(v: ProductRow['variants'][number], ctr?: CatalogTr): T.Variant {
  return {
    id: v.id,
    color: v.color,
    colorLabel: colorLabel(ctr, v.color),
    size: v.size,
    swatch: v.swatch,
    options: optionValues(v.options),
    price: fromCents(v.priceCents),
    inventory: v.inventory,
  }
}

/** Custom options for the product page selectors, in the admin's order; derived from the variants when unset. */
export function customOptionsOf(p: Pick<ProductRow, 'options' | 'variants'>): T.ProductOption[] {
  const defined = optionDefs(p.options).filter((o) => o.kind === 'custom')
  const used = new Map<string, string[]>()
  for (const v of p.variants)
    for (const [name, value] of Object.entries(optionValues(v.options))) {
      const list = used.get(name) ?? []
      if (!list.includes(value)) list.push(value)
      used.set(name, list)
    }
  const names = [...defined.map((o) => o.name), ...[...used.keys()].filter((n) => !defined.some((o) => o.name === n))]
  return names
    .map((name) => {
      const order = defined.find((o) => o.name === name)?.values ?? []
      const values = used.get(name) ?? []
      return { name, values: [...order.filter((v) => values.includes(v)), ...values.filter((v) => !order.includes(v))] }
    })
    .filter((o) => o.values.length > 0)
}

/** Translated text fields of a product (source text when no overlay). */
export function productText(p: { id: string; name: string; short: string; description: string; material: string; care: string | null }, ctr?: CatalogTr) {
  const m = ctr?.product
  return {
    name: tr(m, p.id, 'name', p.name),
    short: tr(m, p.id, 'short', p.short),
    description: tr(m, p.id, 'description', p.description),
    material: tr(m, p.id, 'material', p.material),
    care: p.care == null ? null : tr(m, p.id, 'care', p.care),
  }
}

/** Display name of a category / department (the English name stays the filter and link value). */
export const categoryName = (ctr: CatalogTr | undefined, c: { id: number | string; name: string }) => tr(ctr?.category, c.id, 'name', c.name)
export const departmentName = (ctr: CatalogTr | undefined, d: { id: number | string; name: string }) => tr(ctr?.department, d.id, 'name', d.name)

/** Category names read inside a sentence ("shirts"); German nouns keep their capital. */
export const inSentenceCase = (s: string, locale: string) => (locale === 'de' ? s : s.toLowerCase())

const STOCK_KEY: Record<T.StockState, string> = { in: 'stock.in', low: 'stock.low', out: 'stock.out', digital: 'stock.digital' }

/** `promos`: automatic discounts for `Product.promotion` (loadProductPromotions, once per request).
    `loc` + `ctr` (loadCatalogTr): request language and content overlays; English source text without them. */
export function serializeProduct(p: ProductRow, lowStock = LOW_STOCK, promos: EngineDiscount[] = [], loc: Loc = EN_LOC, ctr?: CatalogTr): T.Product {
  const t = loc.t
  const stock = stockOf(p, lowStock)
  const price = fromCents(p.priceCents)
  const compareAt = fromCentsOrNull(p.compareAtCents)
  const gallery = p.images.map(photoOf)
  const swatchByColor = new Map<string, string>()
  for (const v of p.variants) if (v.color && !swatchByColor.has(v.color)) swatchByColor.set(v.color, v.swatch ?? FALLBACK_SWATCH)
  const sizes = Array.from(new Set(p.variants.map((v) => v.size).filter((s): s is string => !!s)))
  const text = productText(p, ctr)
  const categoryLabel = categoryName(ctr, p.category)

  const badge = compareAt
    ? t('badge.finalPieces', {}, 'Final pieces')
    : stock === 'out'
      ? t('badge.soldOut', {}, 'Sold out')
      : p.tags.includes('digital')
        ? t('badge.digital', {}, 'Digital')
        : p.tags.includes('new')
          ? t('badge.new', {}, 'New')
          : null

  return {
    id: p.id,
    name: text.name,
    brand: p.brand,
    dept: p.department.name,
    deptLabel: departmentName(ctr, p.department),
    category: p.category.name,
    categoryLabel,
    type: p.type as T.ProductType,
    price,
    compareAt,
    sku: p.sku,
    short: text.short,
    description: text.description,
    material: text.material,
    care: text.care,
    tags: p.tags,
    download: p.download,
    image: gallery[0] ?? FALLBACK_PHOTO,
    gallery: gallery.length ? gallery : [FALLBACK_PHOTO],
    variants: p.variants.map((v) => serializeVariant(v, ctr)),
    options: customOptionsOf(p),
    stock,
    stockLabel:
      stock === 'in' && p.allowBackorder && !p.variants.some((v) => (v.inventory ?? 0) > 0)
        ? t('stock.backorder', {}, BACKORDER_LABEL)
        : t(STOCK_KEY[stock], {}, STOCK_LABEL[stock]),
    badge,
    onSale: !!compareAt,
    swatches: Array.from(swatchByColor, ([name, hex]) => ({ name, hex, label: colorLabel(ctr, name) ?? name })),
    sizes,
    alt: t('product.alt', { name: text.name, category: inSentenceCase(categoryLabel, loc.locale), brand: p.brand }, '{name} — {category} by {brand}'),
    createdAt: p.createdAt.toISOString(),
    allowBackorder: p.allowBackorder,
    promotion: promos.length ? promotionFor({ id: p.id, categoryId: p.categoryId, departmentId: p.departmentId, price }, promos) : null,
    rating: p.ratingCount > 0 && p.ratingAvg != null ? { avg: num(p.ratingAvg), count: p.ratingCount } : null,
  }
}

// ─── Journal ────────────────────────────────────────────────────────────────

type PostRow = Prisma.PostGetPayload<object>

/** Journal overlays: `post` (by post id) and `post_category` (by English category name) — see loadPostTr. */
export interface PostTr {
  post: TranslationMap
  category: TranslationMap
}

/** "6 min read" in the request language (stored as English text on the post). */
export function readTime(read: string, loc: Loc): string {
  const m = /^(\d+) min read$/.exec(read.trim())
  return m && loc.locale !== 'en' ? loc.t('post.read', { count: Number(m[1]) }, read) : read
}

export function serializePost(p: PostRow, loc: Loc = EN_LOC, ptr?: PostTr): T.Post {
  const d = p.publishedAt ?? p.createdAt
  return {
    slug: p.slug,
    title: tr(ptr?.post, p.id, 'title', p.title),
    category: p.category,
    categoryLabel: tr(ptr?.category, p.category, 'name', p.category),
    date: loc.locale === 'en' ? displayDate(d) : loc.date(d),
    publishedAt: d.toISOString(),
    read: readTime(p.read, loc),
    author: p.author,
    excerpt: tr(ptr?.post, p.id, 'excerpt', p.excerpt),
    image: asPhoto(p.image),
  }
}

export function serializePostDetail(p: PostRow, related: PostRow[], loc: Loc = EN_LOC, ptr?: PostTr): T.PostDetail {
  const source = (Array.isArray(p.body) ? p.body : []) as unknown as T.PostBlock[]
  const translated = ptr?.post.get(`${p.id}\u0000body`)
  let body = source
  if (translated) {
    try {
      const parsed = JSON.parse(translated) as unknown
      if (Array.isArray(parsed)) body = parsed as T.PostBlock[]
    } catch {
      // keep the source body
    }
  }
  return {
    ...serializePost(p, loc, ptr),
    body,
    related: related.map((r) => serializePost(r, loc, ptr)),
  }
}

// ─── People ─────────────────────────────────────────────────────────────────

/** The template's account row (users) as the customer libraries read it. */
export interface AccountRow {
  id: number
  email: string
  name: string
  createdAt: Date
}

type ProfileRow = Prisma.CustomerProfileGetPayload<object>

/** "Mira Holm" → { firstName: "Mira", lastName: "Holm" } (for accounts without a profile yet). */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

/** Account + profile → the storefront `User` (AccountUser). Role and abilities are the template's (`/site-api/me`),
    not part of this shape (PLAN.md D5). Accounts without a profile yet split their `users.name`. */
export function serializeUser(u: AccountRow, profile: ProfileRow | null, loc: Loc = EN_LOC): T.User {
  const names = profile && (profile.firstName || profile.lastName) ? { firstName: profile.firstName, lastName: profile.lastName } : splitName(u.name)
  return {
    id: String(u.id),
    firstName: names.firstName,
    lastName: names.lastName,
    name: `${names.firstName} ${names.lastName}`.trim() || u.name,
    email: u.email,
    phone: profile?.phone ?? null,
    since: loc.locale === 'en' ? monthYear(u.createdAt) : loc.monthYear(u.createdAt),
    newsletter: profile?.marketingOptIn ?? false,
    locale: profile?.locale ?? null,
    marketingOptIn: profile?.marketingOptIn ?? false,
  }
}

type AddressRow = Prisma.AddressGetPayload<object>

export function serializeAddress(a: AddressRow): T.Address {
  return {
    id: String(a.id),
    label: a.label,
    name: a.name,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    zip: a.zip,
    country: a.country,
    phone: a.phone,
    primary: a.primary,
  }
}

// ─── Orders ─────────────────────────────────────────────────────────────────

type OrderAddress = NonNullable<T.Order['address']>

export function asOrderAddress(json: Prisma.JsonValue | null): OrderAddress | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const o = json as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  return {
    name: s('name'),
    line1: s('line1'),
    line2: typeof o.line2 === 'string' && o.line2 ? o.line2 : null,
    city: s('city'),
    zip: s('zip'),
    country: s('country'),
  }
}

/** `loc`: request language for the display date. Item names, methods and discount labels stay as they were bought. */
export function serializeOrder(o: OrderRow, loc: Loc = EN_LOC): T.Order {
  const items: T.OrderItem[] = o.items.map((i) => {
    const price = fromCents(i.priceCents)
    return {
      lineId: String(i.id),
      productId: i.productId ?? '',
      name: i.name,
      category: i.category,
      sku: i.sku,
      color: i.color,
      size: i.size,
      options: optionValues(i.options),
      qty: i.qty,
      price,
      total: fromCents(i.priceCents * i.qty),
      digital: i.digital,
      image: asPhoto(i.image),
      download: i.download,
      discount: fromCents(i.discountCents),
    }
  })
  return {
    number: o.number,
    date: loc.locale === 'en' ? displayDate(o.placedAt) : loc.date(o.placedAt),
    placedAt: o.placedAt.toISOString(),
    email: o.email,
    phone: o.phone,
    payment: o.payment as T.PaymentStatus,
    fulfillment: o.fulfillment as T.FulfillmentStatus,
    stage: Math.min(4, Math.max(1, o.stage)) as T.Order['stage'],
    canCancel: canCancel(o),
    carrier: o.carrier,
    tracking: o.tracking,
    trackingUrl: o.trackingUrl,
    method: o.method,
    address: asOrderAddress(o.address),
    billingSameAsShipping: o.billingSameAsShipping,
    cardBrand: o.cardBrand,
    cardLast4: o.cardLast4,
    items,
    subtotal: fromCents(o.subtotalCents),
    discountCode: o.discountCode,
    discount: fromCents(o.discountCents),
    discounts: (o.redemptions ?? []).map((r) => ({
      id: String(r.discountId),
      // Snapshots from the order time; rows written before them fall back to the discount as it is now.
      label: r.label ?? summaryLabel(r.discount, r.code),
      code: r.code,
      automatic: r.discount.method === 'automatic',
      amount: (r.freeShipping ?? r.discount.kind === 'shipping') ? 0 : fromCents(r.amountCents),
      freeShipping: r.freeShipping ?? r.discount.kind === 'shipping',
    })),
    shipping: fromCents(o.shippingCents),
    tax: fromCents(o.taxCents),
    total: fromCents(o.totalCents),
    count: items.reduce((n, i) => n + i.qty, 0),
    currency: o.currency,
    pricesIncludeTax: o.pricesIncludeTax,
    taxRate: o.taxRate == null ? null : Number(o.taxRate.toString()),
    customerNote: o.customerNote,
  }
}
