/* Admin catalog: products, variants, inventory, departments, uploads (VAREL src/lib/admin/types.ts, products.ts).
   Routes: /site-api/manage/products (WP-17), /manage/inventory and /manage/taxonomy (WP-18),
   /manage/uploads (WP-17, platform files: D8). */
import type { ProductType, StockState } from '../catalog'
import type { Photo } from '../common'
import type { ListParams } from './common'

export type { ProductType, StockState }

export type ProductStatus = 'draft' | 'published' | 'archived'

export interface AdminVariant {
  id: string // SKU
  color: string | null
  size: string | null
  swatch: string | null
  /** Custom option values, e.g. { Fabric: 'Canvas' } (colour and size have their own fields) */
  options: Record<string, string>
  price: number
  inventory: number | null // null for digital
}

/** One variant option in display order; colour and size are built in, any other name is custom. */
export interface AdminProductOption {
  kind: 'color' | 'size' | 'custom'
  name: string
  values: string[]
}

export interface AdminImage {
  id: string
  src: string // absolute URL (seed images, platform public file links)
  credit: string | null
  creditHref: string | null
  position: number
  /** Platform file id when uploaded here (D8); null for https seed images */
  fileId?: string | null
}

export interface AdminProductRow {
  id: string // slug
  name: string
  dept: string
  category: string
  type: ProductType
  status: ProductStatus
  price: number
  compareAt: number | null
  sku: string
  image: Photo | null
  variantCount: number
  inventory: number | null // sum, null for digital
  stock: StockState
  updatedAt: string // ISO
}

export type WeightUnit = 'kg' | 'g' | 'lb' | 'oz'
export type DimensionUnit = 'cm' | 'in'

export interface AdminProduct extends AdminProductRow {
  brand: string
  short: string
  description: string
  material: string
  care: string | null
  tags: string[]
  download: string | null
  images: AdminImage[]
  variants: AdminVariant[]
  createdAt: string
  orderCount: number // orders containing this product (delete becomes archive when > 0)
  // Phase 2/3
  allowBackorder: boolean // sell past zero stock ("Made to order · ships in 2–3 weeks")
  featured: boolean // home page "featured" row
  categoryPosition: number // manual order inside its category
  seoTitle: string | null
  seoDescription: string | null
  costPerItem: number | null // admin only: profit and margin
  weight: number | null // packed weight in weightUnit
  weightUnit: WeightUnit
  packageLength: number | null // packed size in dimensionUnit
  packageWidth: number | null
  packageHeight: number | null
  dimensionUnit: DimensionUnit
  /** Variant options in order (up to 3); empty on older products, where colour and size are read from the variants */
  options: AdminProductOption[]
}

export interface AdminProductInput {
  id?: string // slug; generated from name when omitted on create; immutable after create
  name: string
  brand: string
  dept: string // department name, e.g. "Women"
  category: string // category name within dept, e.g. "Shirts"
  type: ProductType
  status: ProductStatus
  price: number
  compareAt: number | null
  sku: string
  short: string
  description: string
  material: string
  care: string | null
  tags: string[]
  download: string | null
  images: { src: string; credit?: string | null; creditHref?: string | null; fileId?: string | null }[] // order = position
  variants: {
    id: string // SKU, unique across the store
    color: string | null
    size: string | null
    swatch: string | null
    options?: Record<string, string>
    price: number
    inventory: number | null
  }[]
  allowBackorder?: boolean
  featured?: boolean
  categoryPosition?: number
  seoTitle?: string | null
  seoDescription?: string | null
  costPerItem?: number | null
  weight?: number | null
  weightUnit?: WeightUnit
  packageLength?: number | null
  packageWidth?: number | null
  packageHeight?: number | null
  dimensionUnit?: DimensionUnit
  options?: AdminProductOption[]
}

export interface InventoryRow {
  variantId: string // SKU
  productId: string
  productName: string
  color: string | null
  size: string | null
  options: Record<string, string> // custom option values
  inventory: number
  state: 'in' | 'low' | 'out' // per-variant: 0 out, 1–lowStockThreshold low (same thresholds as storefront)
  image: Photo | null
}

/** POST /site-api/manage/uploads → a platform upload grant; POST /manage/uploads/:id/complete → the stored image */
export interface UploadResult {
  /** Platform file id (keep it with the image) */
  id: string
  /** Public link (`publicFileUrl`) */
  url: string
  contentType: string
  size: number
}

export interface AdminCategory {
  id: string
  name: string
  slug: string
  position: number
  productCount: number
}

export interface AdminDepartment {
  id: string
  name: string
  slug: string
  position: number
  productCount: number
  categories: AdminCategory[]
}

export interface ProductListParams extends ListParams {
  status?: ProductStatus[]
  dept?: string
  category?: string
  stock?: StockState[]
}

export interface InventoryListParams extends ListParams {
  state?: InventoryRow['state'][]
}

export type ProductBulkAction = { status: ProductStatus } | 'delete'

export interface ProductBulkResult {
  done: string[]
  /** Delete only: products with orders that the server archived instead */
  archived: string[]
  failed: { id: string; error: unknown }[]
}

export type InventoryChange = { variantId: string } & ({ inventory: number } | { adjust: number })
