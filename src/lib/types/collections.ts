/* Merchandising for the storefront: collections (docs/PHASE2-3.md §7, VAREL src/lib/api/collections.ts).
   GET /site-api/collections (?featured=true) · GET /site-api/collections/:slug (collections.ts, WP-05). */
import type { Photo } from './common'
import type { Product } from './catalog'

export interface CollectionSummary {
  slug: string
  title: string
  description: string
  /** Uploaded image, or the first product's photo; null for an empty collection without an image */
  image: Photo | null
  featuredOnHome: boolean
  productCount: number
  seoTitle: string | null
  seoDescription: string | null
}

export interface CollectionDetail extends CollectionSummary {
  /** Storefront products in the curated order */
  products: Product[]
}
