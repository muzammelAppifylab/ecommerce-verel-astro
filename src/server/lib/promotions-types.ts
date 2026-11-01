/* Contract for the pure promotions engine — see docs/PROMOTIONS.md ("Engine rules").
   `evaluatePromotions(input: EngineInput): EngineResult` is exported from ./discounts.ts.
   No database access: callers load discounts, customer history and lines first. */

export type EngineDiscountKind = 'percent' | 'fixed' | 'shipping' | 'bxgy'
export type EngineScope = 'order' | 'products' | 'categories' | 'departments'
export type EngineEligibility = 'everyone' | 'signed_in' | 'first_order' | 'subscribers' | 'customers'

export type DiscountErrorCode =
  | 'DISCOUNT_INVALID'
  | 'DISCOUNT_INACTIVE'
  | 'DISCOUNT_NOT_STARTED'
  | 'DISCOUNT_EXPIRED'
  | 'DISCOUNT_USED_UP'
  | 'DISCOUNT_NOT_ELIGIBLE'
  | 'DISCOUNT_CUSTOMER_LIMIT'
  | 'DISCOUNT_NOT_APPLICABLE'
  | 'DISCOUNT_MIN_QTY'
  | 'DISCOUNT_MINIMUM'
  | 'DISCOUNT_NOT_COMBINABLE'

export interface EngineLine {
  lineId: string
  productId: string
  categoryId: string
  departmentId: string
  unit: number // unit price in dollars
  qty: number
  digital: boolean
}

export interface EngineDiscount {
  id: string
  method: 'code' | 'automatic'
  name: string
  code: string | null
  codeType: 'shared' | 'unique'
  kind: EngineDiscountKind
  value: number
  maxAmount: number | null
  buyQty: number | null
  getQty: number | null
  getPercent: number | null
  scope: EngineScope
  productIds: string[]
  categoryIds: string[]
  departmentIds: string[]
  minimum: number
  minimumQty: number | null
  eligibility: EngineEligibility
  customerIds: string[]
  usageLimit: number | null
  perCustomerLimit: number | null
  combinable: boolean
  priority: number
  label: string
  active: boolean
  startsAt: Date | null
  endsAt: Date | null
  createdAt: Date
  used: number // total redemptions so far
  /** For unique codes: whether the specific entered code has already been used */
  uniqueCodeUsed?: boolean
  /** Optional: the scope in words for customer messages, e.g. "T-shirts" or "knitwear" (filled by the loader) */
  scopeLabel?: string
}

export interface EngineCustomer {
  id: string | null // account id when signed in
  email: string | null // account or checkout email (null for a guest at the cart stage)
  signedIn: boolean
  paidOrders: number // previous orders that were paid: payment Paid or Refunded (account id or email)
  subscriber: boolean // newsletter subscriber (by email)
  /** Previous redemptions by this customer (account id or email), keyed by discount id */
  redemptions: Record<string, number>
}

export interface EngineInput {
  lines: EngineLine[]
  code: EngineDiscount | null // discount behind the entered code (null if unknown or none entered)
  codeEntered: string | null // raw code typed by the customer; non-null + code null → DISCOUNT_INVALID
  automatic: EngineDiscount[] // automatic discounts (engine still checks active/schedule/limits)
  customer: EngineCustomer
  stage: 'cart' | 'checkout'
  /** Rate of the selected shipping method, used only to value free-shipping when comparing outcomes */
  shippingRate: number
  /** Free-shipping threshold, compared with the merchandise after each outcome's discounts. Without it,
      `shippingRate` is taken as what free shipping is worth on this bag. */
  freeThreshold?: number
  now: Date
  /** Optional translator for `rejected.message` (serverT bound to the request locale). Default: English. */
  t?: (key: string, vars: Record<string, string | number>, fallback: string) => string
}

export interface AppliedDiscount {
  discountId: string
  method: 'code' | 'automatic'
  code: string | null
  label: string
  amount: number // merchandise discount (0 for free shipping)
  freeShipping: boolean
  allocations: { lineId: string; amount: number }[] // sums exactly to amount
}

export interface EngineResult {
  applied: AppliedDiscount[] // in application order
  rejected: { code: DiscountErrorCode; message: string } | null // why the entered code is not applied
  discountTotal: number
  freeShipping: boolean
  /** Per-line total discount (sum of allocations across applied discounts) */
  lineDiscounts: Record<string, number>
}
