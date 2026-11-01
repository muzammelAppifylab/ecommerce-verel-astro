/* Admin promotions: discounts, unique codes, reports, the scope picker (docs/PROMOTIONS.md,
   VAREL src/lib/admin/types.ts + promotions.ts). Routes: /site-api/manage/discounts (WP-21). */
import type { ListParams } from './common'

export type DiscountKindShared = 'percent' | 'fixed' | 'shipping'
export type DiscountMethod = 'code' | 'automatic'
export type DiscountCodeType = 'shared' | 'unique'
export type DiscountKind = DiscountKindShared | 'bxgy'
export type DiscountScope = 'order' | 'products' | 'categories' | 'departments'
export type DiscountEligibility = 'everyone' | 'signed_in' | 'first_order' | 'subscribers' | 'customers'
export type DiscountStatus = 'active' | 'scheduled' | 'expired' | 'inactive' | 'used_up'

export interface AdminDiscount {
  id: string
  method: DiscountMethod
  name: string // internal name; customer-facing for automatic discounts
  code: string | null // uppercase; null for automatic and for unique-code batches
  codeType: DiscountCodeType
  kind: DiscountKind
  value: number // percent 0–100 or money; unused for shipping/bxgy
  maxAmount: number | null // cap for percent
  buyQty: number | null // bxgy
  getQty: number | null // bxgy
  getPercent: number | null // bxgy, 100 = free
  scope: DiscountScope
  productIds: string[]
  categoryIds: string[]
  departmentIds: string[]
  minimum: number // in-scope spend
  minimumQty: number | null
  eligibility: DiscountEligibility
  customerIds: string[]
  usageLimit: number | null
  perCustomerLimit: number | null
  combinable: boolean
  priority: number
  label: string // "10% off"
  note: string // "Minimum spend $100"
  active: boolean
  startsAt: string | null
  endsAt: string | null
  status: DiscountStatus // derived
  summary: string // plain-language rule, e.g. "15% off Knitwear · first order only · ends 31 Dec"
  used: number // redemptions
  totalDiscounted: number // sum of redemption amounts
  revenue: number // sum of totals of orders that used it
  codesTotal: number // unique codes generated (0 for shared)
  codesUsed: number
  createdAt: string
  updatedAt: string
}

export type AdminDiscountInput = Omit<
  AdminDiscount,
  'id' | 'status' | 'summary' | 'used' | 'totalDiscounted' | 'revenue' | 'codesTotal' | 'codesUsed' | 'createdAt' | 'updatedAt'
>

export interface AdminDiscountCode {
  id: string
  code: string
  usedAt: string | null
  orderNumber: string | null
  createdAt: string
}

export interface AdminDiscountReport {
  discount: AdminDiscount
  uses: number
  customers: number // distinct accounts/emails
  discountGiven: number
  revenue: number
  averageOrder: number
  byDay: { date: string; uses: number; discount: number; revenue: number }[] // last 30 days, oldest first
  recent: {
    orderNumber: string
    placedAt: string
    customer: string
    email: string
    code: string | null
    amount: number
    orderTotal: number
  }[] // max 20
}

/** GET /site-api/manage/discounts (not paged in VAREL: a store has few discounts; capped at 100) */
export interface DiscountListParams {
  q?: string
  method?: DiscountMethod
  status?: DiscountStatus[]
}

export type DeleteResult = { deactivated?: boolean; discount?: AdminDiscount } | undefined

export interface DiscountBulkResult {
  done: AdminDiscount[]
  /** Delete: used discounts the API deactivated instead of deleting */
  deactivated: AdminDiscount[]
  failed: { discount: AdminDiscount; error: unknown }[]
}

/** POST /site-api/manage/discounts/:id/codes */
export interface GenerateCodesInput {
  count: number // 1–5000
  prefix?: string // ≤ 20 of A–Z 0–9 - _
  length?: number // 6–16, default 8
}

export interface CodeListParams extends ListParams {
  used?: boolean
}

export interface PreviewTarget {
  id: string
  name: string
  image?: string | { src?: string; url?: string } | null
  /** Categories: the department they belong to, when the API sends it */
  dept?: string | null
  department?: string | null
}

/** GET /site-api/manage/discounts/preview?q= */
export interface DiscountPreview {
  products: PreviewTarget[]
  categories: PreviewTarget[]
  departments: PreviewTarget[]
  customers?: { id: string; name: string; email: string }[]
}
