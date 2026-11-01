/* Catalog queries: filtering, facets, related (port of VAREL worker/lib/catalog.ts, from varel-store.js).
   VAREL filters the published catalog in memory (facets are derived from the products in view). That stays,
   bounded: the department / category of the request are filtered in the database (indexed), then at most
   CATALOG_LIMIT (100) published products, read with an explicit select, are filtered and faceted in memory.
   VAREL's catalog has 11; a store that outgrows the cap needs database-side facets (see the F4 hand-off). */
import type { Db } from './db'
import { categoryName, departmentName, productSelect, productText, serializeProduct, stockOf, type ProductRow } from './serializers'
import { slugify } from './format'
import { toPlainText } from './rich-text'
import { fromCents } from './money'
import { getSettings } from './settings'
import { loadProductPromotions } from './promotions-loader'
import type * as T from './contract-types'
import type { Prisma } from '../../generated/prisma/client'
import { EN_LOC, colorLabel, loadCatalogTr, type CatalogTr, type Loc } from './i18n/localize'

/** Only published products reach the storefront. */
export const PUBLISHED = { status: 'published' } as const

/** Most published products read in one request (bounded query, AGENTS.md). */
export const CATALOG_LIMIT = 100

/** Setting.hideSoldOut: fully sold-out products leave listings, related and search (product pages still work). */
export const listable = (s: { hideSoldOut: boolean }) => (p: ProductRow) => !s.hideSoldOut || stockOf(p) !== 'out'

/** Published products (storefront), in merchandising order; `where` narrows them in the database first.
    At most CATALOG_LIMIT rows (index products(status, position, id)). */
export async function allProducts(db: Db, where: Prisma.ProductWhereInput = {}): Promise<ProductRow[]> {
  return db.product.findMany({
    where: { ...where, ...PUBLISHED },
    select: productSelect,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: CATALOG_LIMIT,
  })
}

/** Database filter for a list of department / category values (slug or English name, as slugIn matches). */
function taxonomyWhere(set: string[]): Prisma.DepartmentWhereInput | undefined {
  const values = set.map((s) => s.trim()).filter(Boolean)
  if (!values.length) return undefined
  return {
    OR: [
      { slug: { in: Array.from(new Set(values.map(slugify))) } },
      ...values.map((v) => ({ name: { equals: v, mode: 'insensitive' as const } })),
    ],
  }
}

/** The database part of a listing query: department and category (the in-memory filters stay authoritative). */
export function listingWhere(query: Pick<ListQuery, 'dept' | 'category' | 'featured'>): Prisma.ProductWhereInput {
  const dept = taxonomyWhere(query.dept)
  const category = taxonomyWhere(query.category) as Prisma.CategoryWhereInput | undefined
  return {
    ...(dept ? { department: dept } : {}),
    ...(category ? { category } : {}),
    ...(query.featured ? { featured: true } : {}),
  }
}

const priceOf = (p: ProductRow) => fromCents(p.priceCents)

const haystack = (p: ProductRow, ctr?: CatalogTr) => {
  const parts = [p.name, p.brand, p.department.name, p.category.name, p.material, p.short, toPlainText(p.description), ...p.tags]
  if (ctr) {
    // The request language too: search matches translated names, categories and colours.
    const t = productText(p, ctr)
    parts.push(t.name, t.material, t.short, toPlainText(t.description), categoryName(ctr, p.category), departmentName(ctr, p.department))
    for (const v of p.variants) if (v.color) parts.push(colorLabel(ctr, v.color) ?? '')
  }
  return parts.join(' ').toLowerCase()
}

/** Every word of the query must appear somewhere in the product's text (source or, with `ctr`, translated). */
export function matchesQuery(p: ProductRow, q: string, ctr?: CatalogTr): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = haystack(p, ctr)
  return words.every((w) => text.includes(w))
}

const inSet = (value: string | null | undefined, set: string[]) =>
  !set.length || (!!value && set.some((s) => s.toLowerCase() === value.toLowerCase()))

const slugIn = (value: { name: string; slug: string }, set: string[]) =>
  !set.length || set.some((s) => slugify(s) === value.slug || s.toLowerCase() === value.name.toLowerCase())

/** Port of VARELStore.facets(): derived from the products in view, single-value facets dropped.
    Category and colour values stay English (filter values) with display `labels`; material values are the
    translated text (as on Product.material — the filter accepts both). */
export function facetsOf(list: ProductRow[], loc: Loc = EN_LOC, ctr?: CatalogTr): T.Facet[] {
  const t = loc.t
  const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)))
  const sorted = (xs: (string | null | undefined)[]) => uniq(xs).sort()
  const catLabels: Record<string, string> = {}
  for (const p of list) catLabels[p.category.name] ??= categoryName(ctr, p.category)
  const colors = sorted(list.flatMap((p) => p.variants.map((v) => v.color)))
  const facets: T.Facet[] = [
    { key: 'category', label: t('facet.category', {}, 'Category'), values: sorted(list.map((p) => p.category.name)), labels: catLabels },
    {
      key: 'color',
      label: t('facet.color', {}, 'Colour'),
      values: colors,
      labels: Object.fromEntries(colors.map((c) => [c, colorLabel(ctr, c) ?? c])),
    },
    { key: 'size', label: t('facet.size', {}, 'Size'), values: uniq(list.flatMap((p) => p.variants.map((v) => v.size))) },
    { key: 'material', label: t('facet.material', {}, 'Material'), values: sorted(list.map((p) => productText(p, ctr).material)) },
    { key: 'brand', label: t('facet.brand', {}, 'Brand'), values: sorted(list.map((p) => p.brand)) },
  ]
  return facets.filter((f) => f.values.length > 1)
}

export interface ListQuery {
  dept: string[]
  category: string[]
  q: string
  color: string[]
  size: string[]
  material: string[]
  brand: string[]
  tag: string[]
  maxPrice?: number
  sort: 'featured' | 'newest' | 'price-asc' | 'price-desc'
  limit?: number
  /** Merchandising: only products flagged `featured` (home "Featured" row) */
  featured?: boolean
}

export async function listProducts(db: Db, query: ListQuery, loc: Loc = EN_LOC): Promise<T.ProductListResponse> {
  const [all, settings, promos] = await Promise.all([
    allProducts(db, listingWhere(query)),
    getSettings(db),
    loadProductPromotions(db, undefined, loc),
  ])
  const ctr = await loadCatalogTr(db, loc, all)
  const { lowStockThreshold } = settings
  // Base set (dept / category / q) — facets and priceMax come from here, before facet filters.
  const base = all
    .filter(listable(settings))
    .filter((p) => slugIn(p.department, query.dept) && slugIn(p.category, query.category) && matchesQuery(p, query.q, ctr))
  let items = base.filter(
    (p) =>
      (!query.color.length || p.variants.some((v) => inSet(v.color, query.color))) &&
      (!query.size.length || p.variants.some((v) => inSet(v.size, query.size))) &&
      (inSet(p.material, query.material) || (!!ctr && inSet(productText(p, ctr).material, query.material))) &&
      inSet(p.brand, query.brand) &&
      (!query.tag.length || query.tag.some((t) => p.tags.includes(t.toLowerCase()))) &&
      (query.maxPrice == null || priceOf(p) <= query.maxPrice) &&
      (!query.featured || p.featured),
  )
  // Merchandising: inside a category, "featured" follows the manual category order (admin › Collections).
  if (query.sort === 'featured' && query.category.length) items = [...items].sort((a, b) => a.categoryPosition - b.categoryPosition)
  if (query.sort === 'newest') items = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  if (query.sort === 'price-asc') items = [...items].sort((a, b) => a.priceCents - b.priceCents || a.position - b.position)
  if (query.sort === 'price-desc') items = [...items].sort((a, b) => b.priceCents - a.priceCents || a.position - b.position)

  const total = items.length
  if (query.limit) items = items.slice(0, query.limit)
  return {
    items: items.map((p) => serializeProduct(p, lowStockThreshold, promos, loc, ctr)),
    facets: facetsOf(base, loc, ctr),
    total,
    priceMax: base.reduce((m, p) => Math.max(m, priceOf(p)), 0),
  }
}

/** Port of VARELStore.related(): same dept or category first, then the rest (merchandising order).
    Bounded: two indexed reads of at most CATALOG_LIMIT rows instead of the whole catalog. */
export async function relatedProducts(db: Db, id: string, limit: number, loc: Loc = EN_LOC): Promise<T.Product[] | null> {
  const take = Math.max(0, Math.min(limit, CATALOG_LIMIT))
  const [p, settings, promos] = await Promise.all([
    db.product.findFirst({ where: { id, ...PUBLISHED }, select: { id: true, departmentId: true, category: { select: { name: true } } } }),
    getSettings(db),
    loadProductPromotions(db, undefined, loc),
  ])
  if (!p) return null
  const { lowStockThreshold } = settings
  const near: Prisma.ProductWhereInput = { OR: [{ departmentId: p.departmentId }, { category: { name: p.category.name } }] }
  const same = (await allProducts(db, { id: { not: id }, ...near })).filter(listable(settings))
  let picked = same.slice(0, take)
  if (picked.length < take) {
    const rest = (await allProducts(db, { id: { notIn: [id, ...same.map((x) => x.id)] }, NOT: near })).filter(listable(settings))
    picked = [...picked, ...rest].slice(0, take)
  }
  const ctr = await loadCatalogTr(db, loc, picked)
  return picked.map((x) => serializeProduct(x, lowStockThreshold, promos, loc, ctr))
}
