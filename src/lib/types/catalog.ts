/* Catalog shapes: products, variants, taxonomy, listing (VAREL src/lib/api/types.ts + endpoints.ts).
   Routes: GET /site-api/taxonomy, /site-api/products (catalog.ts, WP-02), /site-api/products/:slug,
   /:slug/related (product.ts, WP-03), /site-api/search (search.ts, WP-08). */
import type { Photo } from './common'
import type { Post } from './content'

export type StockState = 'in' | 'low' | 'out' | 'digital'
export type ProductType = 'physical' | 'digital'

export interface Variant {
  id: string // SKU, e.g. VRL-FRM-STO-M
  color: string | null
  /** Colour name in the request language (display only; `color` stays the English selection value) */
  colorLabel?: string | null
  size: string | null
  /** Custom option values, e.g. { Fabric: 'Canvas' } (colour and size have their own fields) */
  options: Record<string, string>
  swatch: string | null // hex
  price: number
  inventory: number | null // null for digital
}

export interface Swatch {
  name: string // English colour name: the selection value (matches Variant.color)
  hex: string
  /** Colour name in the request language (display only) */
  label?: string
}

/** A custom variant option, e.g. { name: 'Fabric', values: ['Canvas', 'Cork'] } */
export interface ProductOption {
  name: string
  values: string[]
}

export interface Product {
  id: string // slug, e.g. "forma-overshirt"
  name: string
  brand: string
  dept: string // English department name (link / filter value: slugify(dept))
  category: string // English category name (link / filter value)
  /** Department and category names in the request language (display, breadcrumbs) */
  deptLabel?: string
  categoryLabel?: string
  type: ProductType
  price: number
  compareAt: number | null
  sku: string
  short: string
  description: string
  material: string
  care: string | null
  tags: string[]
  download: string | null
  image: Photo // primary
  gallery: Photo[] // primary first, then alternates
  variants: Variant[]
  /** Custom options (beyond colour and size) to choose from on the product page, in order */
  options: ProductOption[]
  // derived
  stock: StockState
  stockLabel: string
  badge: string | null
  onSale: boolean
  swatches: Swatch[]
  sizes: string[]
  alt: string // "Forma Overshirt — shirts by VAREL"
  createdAt: string
  /** Best automatic promotion covering this product, e.g. { label: "15% off knitwear" } — see docs/PROMOTIONS.md */
  promotion: { label: string; discountId: string } | null
  /** Sold past zero stock ("Made to order · ships in 2–3 weeks"); variants at 0 stay purchasable */
  allowBackorder?: boolean
  /** Approved-review average and count; null until a review is approved */
  rating: { avg: number; count: number } | null
  /** SEO overrides from the admin (null = derived from name / short) */
  seoTitle?: string | null
  seoDescription?: string | null
}

export interface Facet {
  key: 'category' | 'color' | 'size' | 'material' | 'brand'
  label: string
  values: string[]
  /** Display text per value in the request language (category and colour facets; values stay English) */
  labels?: Record<string, string>
}

/** GET /site-api/products. The catalog is small and capped (`limit` ≤ 100), so `total` stays as in VAREL. */
export interface ProductListResponse {
  items: Product[]
  facets: Facet[]
  total: number
  priceMax: number
}

export interface Department {
  name: string // "Women"
  slug: string // "women"
  /** Name in the request language (display) */
  label?: string
  categories: { name: string; slug: string; count: number; label?: string }[]
  count: number
}

export type ProductSort = 'featured' | 'newest' | 'price-asc' | 'price-desc'

/** GET /site-api/products query (multi-value filters comma-separated or repeated). */
export interface ProductQuery {
  dept?: string
  category?: string
  q?: string
  color?: string[]
  size?: string[]
  material?: string[]
  brand?: string[]
  maxPrice?: number
  tag?: string
  sort?: ProductSort
  limit?: number
  /** Home "featured" row (docs/PHASE2-3.md §7) */
  featured?: boolean
}

/** GET /site-api/search?q= */
export interface SearchResponse {
  query: string
  products: Product[]
  /** dept / category: English names (link values); deptLabel / categoryLabel: request language (display) */
  categories: { dept: string; category: string; count: number; deptLabel?: string; categoryLabel?: string }[]
  posts: Post[]
}
