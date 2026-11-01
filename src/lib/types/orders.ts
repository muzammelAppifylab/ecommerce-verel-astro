/* Checkout, orders and returns on the storefront (VAREL src/lib/api/types.ts + endpoints.ts).
   Routes: /site-api/checkout (checkout.ts, WP-11), /site-api/orders (orders.ts, WP-14),
   /site-api/returns (returns.ts, WP-14), /site-api/shipping + /site-api/countries (shipping.ts, WP-11). */
import type { AppliedDiscountSummary } from './cart'
import type { Address } from './account'
import type { Photo } from './common'

export interface OrderItem {
  lineId: string
  productId: string
  name: string
  category: string
  sku: string
  color: string | null
  size: string | null
  options: Record<string, string>
  qty: number
  price: number
  total: number
  digital: boolean
  image: Photo
  download: string | null
  discount: number // allocated share of the order's discounts
}

export type PaymentStatus = 'Paid' | 'Pending' | 'Refunded' | 'Failed'
export type FulfillmentStatus = 'Unfulfilled' | 'Processing' | 'Shipped' | 'Delivered' | 'Returned' | 'Cancelled'

export interface Order {
  number: string // "VRL-24817"
  date: string // "18 August 2026"
  placedAt: string // ISO
  email: string
  phone: string | null
  payment: PaymentStatus
  fulfillment: FulfillmentStatus
  stage: 1 | 2 | 3 | 4 // 1 placed, 2 packed, 3 shipped, 4 delivered
  canCancel: boolean // the customer can still cancel (not packed yet); POST /orders/:number/cancel
  carrier: string | null
  tracking: string | null
  trackingUrl: string | null
  method: string // "Express · 1–2 days"
  address: Omit<Address, 'id' | 'label' | 'primary' | 'phone'> | null
  billingSameAsShipping: boolean
  cardBrand: string | null
  cardLast4: string | null
  items: OrderItem[]
  subtotal: number
  discountCode: string | null
  discount: number
  discounts: AppliedDiscountSummary[]
  shipping: number
  tax: number
  total: number
  count: number
  /** ISO 4217 currency the order was placed in (format its amounts with it) */
  currency?: string
  /** Whether the order's prices included tax */
  pricesIncludeTax?: boolean
  /** Tax rate applied (country rate or the default), null for older orders */
  taxRate?: number | null
  /** Note the customer left at checkout */
  customerNote?: string | null
}

export interface CheckoutAddress {
  name: string
  line1: string
  line2?: string
  city: string
  /** State / province / county code where the country's addresses carry one; the API writes it after the city */
  region?: string
  zip: string
  country: string
}

/** POST /site-api/checkout */
export interface CheckoutRequest {
  email: string
  phone?: string
  newsletter?: boolean
  shippingAddress: CheckoutAddress | null // null only for digital-only bags
  shippingMethodId: string | null
  billingSameAsShipping: boolean
  billingAddress?: CheckoutAddress | null
  /** Card details for the simulated provider; omitted when Stripe's Payment Element collects them */
  payment?: { name: string; number: string; expiry: string; cvc: string } | null
  saveAddress?: boolean
  /** Order note, when the store has order notes on (≤ 500 characters) */
  customerNote?: string
  /** Required (true) when the store has terms text */
  acceptTerms?: boolean
  /** The total shown to the customer; when the server total differs, checkout returns 409 total_changed */
  expectedTotal?: number
}

/** GET /site-api/checkout/config: the payment provider checkout uses right now */
export interface CheckoutConfig {
  provider: 'stripe' | 'simulated'
  publishableKey: string | null
  currency: string
}

/** How to finish paying for a new order (POST /site-api/checkout) */
export type CheckoutPayment =
  | { provider: 'simulated' }
  | { provider: 'stripe'; clientSecret: string; publishableKey: string }

export interface CheckoutResponse {
  order: Order
  payment: CheckoutPayment
}

export type OrderStatusFilter = 'open' | 'completed' | 'returned'

export type CancelReason = 'changed_mind' | 'ordered_by_mistake' | 'wrong_size' | 'too_slow' | 'other'

/** POST /site-api/orders/:number/cancel and /site-api/checkout/:number/cancel */
export interface CancelOrderInput {
  email?: string
  reason?: CancelReason
}

/** POST /site-api/returns/lookup */
export interface ReturnLookupInput {
  order: string
  email?: string
}
export interface ReturnLookupResponse {
  order: Order
  eligible: boolean
  reason?: string
}
/** POST /site-api/returns */
export interface CreateReturnInput {
  order: string
  email?: string
  items: { lineId: string; qty: number; reason: string }[]
}
export interface CreateReturnResponse {
  id: string
  status: 'Requested'
}

export interface ShippingMethod {
  id: string // e.g. "denmark-express"
  name: string // "Express"
  detail: string // "Next day"
  rate: number
}

export interface ShippingZone {
  zone: string
  methods: ShippingMethod[]
}

/** GET /site-api/shipping/zones */
export interface ShippingZonesResponse {
  freeThreshold: number
  zones: ShippingZone[]
}

/** GET /site-api/shipping/methods?country= */
export interface ShippingMethodsResponse {
  zone: string
  methods: ShippingMethod[]
}
