/* Merchandising: collections (curated product sets) — shared by the public and admin routes (port of VAREL
   worker/lib/collections.ts). Contract: docs/PHASE2-3.md §7. */
import type { Prisma } from '../../generated/prisma/client'
import type { Db } from './db'
import { allProducts } from './catalog'
import { getSettings } from './settings'
import { loadProductPromotions } from './promotions-loader'
import { asPhoto, photoOf, serializeProduct } from './serializers'
import type * as T from './contract-types'
import { EN_LOC, loadCatalogTr, loadFor, tr, type Loc, type TranslationMap } from './i18n/localize'

export interface CollectionSummary {
  slug: string
  title: string
  description: string
  /** The collection image, or the first product's photo when none was uploaded */
  image: T.Photo | null
  featuredOnHome: boolean
  productCount: number
  seoTitle: string | null
  seoDescription: string | null
}

export interface CollectionDetail extends CollectionSummary {
  products: T.Product[]
}

/** Most products a collection shows (the admin caps a collection at 100 too). */
export const COLLECTION_PRODUCT_LIMIT = 100

export const collectionInclude = {
  products: {
    orderBy: { position: 'asc' },
    take: COLLECTION_PRODUCT_LIMIT,
    select: {
      productId: true,
      position: true,
      product: {
        select: { id: true, status: true, images: { orderBy: { position: 'asc' }, take: 1, select: { src: true, credit: true, creditHref: true } } },
      },
    },
  },
} satisfies Prisma.CollectionInclude

export type CollectionRow = Prisma.CollectionGetPayload<{ include: typeof collectionInclude }>

/** Stored image JSON → Photo, or null when nothing usable is stored. */
export function storedPhoto(json: Prisma.JsonValue | null | undefined): T.Photo | null {
  if (!json || typeof json !== 'object' || Array.isArray(json) || typeof (json as { src?: unknown }).src !== 'string') return null
  return asPhoto(json)
}

const publishedLinks = (c: CollectionRow) => c.products.filter((l) => l.product.status === 'published')

/** `m`: collection overlays (loadFor 'collection'); source text without. */
export function collectionSummary(c: CollectionRow, m?: TranslationMap): CollectionSummary {
  const live = publishedLinks(c)
  const first = live[0]?.product.images[0]
  return {
    slug: c.slug,
    title: tr(m, c.id, 'title', c.title),
    description: tr(m, c.id, 'description', c.description),
    image: storedPhoto(c.image) ?? (first ? photoOf(first) : null),
    featuredOnHome: c.featuredOnHome,
    productCount: live.length,
    seoTitle: c.seoTitle == null ? null : tr(m, c.id, 'seoTitle', c.seoTitle),
    seoDescription: c.seoDescription == null ? null : tr(m, c.id, 'seoDescription', c.seoDescription),
  }
}

/** Published collections in merchandising order (optionally only those featured on the home page); at most 100. */
export async function listCollections(db: Db, opts: { featured?: boolean } = {}, loc: Loc = EN_LOC): Promise<CollectionSummary[]> {
  const rows = await db.collection.findMany({
    where: { published: true, ...(opts.featured ? { featuredOnHome: true } : {}) },
    include: collectionInclude,
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  })
  const m = await loadFor(db, loc, 'collection', rows.map((r) => r.id))
  return rows.map((r) => collectionSummary(r, m))
}

/** A published collection with its storefront products in the curated order; null when missing or unpublished. */
export async function collectionBySlug(db: Db, slug: string, loc: Loc = EN_LOC): Promise<CollectionDetail | null> {
  const row = await db.collection.findUnique({ where: { slug }, include: collectionInclude })
  if (!row || !row.published) return null
  // allProducts() applies the storefront rules (published) so collections match the shop; only the linked ones.
  const ids = row.products.filter((l) => l.product.status === 'published').map((l) => l.productId)
  const [all, { lowStockThreshold }, promos, m] = await Promise.all([
    ids.length ? allProducts(db, { id: { in: ids } }) : Promise.resolve([]),
    getSettings(db),
    loadProductPromotions(db, undefined, loc),
    loadFor(db, loc, 'collection', [row.id]),
  ])
  const byId = new Map(all.map((p) => [p.id, p]))
  const rows = row.products.map((l) => byId.get(l.productId)).filter((p): p is NonNullable<typeof p> => !!p)
  const ctr = await loadCatalogTr(db, loc, rows)
  const products = rows.map((p) => serializeProduct(p, lowStockThreshold, promos, loc, ctr))
  return { ...collectionSummary(row, m), productCount: products.length, products }
}
