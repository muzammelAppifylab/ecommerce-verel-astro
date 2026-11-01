/* Bag, totals, wishlist and discounts on the storefront (VAREL src/lib/api/types.ts + endpoints.ts).
   Routes: /site-api/cart (cart.ts, WP-09), /site-api/wishlist (wishlist.ts, WP-10). Guests are identified by
   the `visitor_id` cookie (src/server/lib/visitor.ts, F4), signed-in customers by their account (D5). */
import type { Photo } from './common'
import type { ProductType } from './catalog'

/** One discount applied to a bag or order (docs/PROMOTIONS.md). */
export interface AppliedDiscountSummary {
  id: string
  label: string // "Autumn knitwear · 15% off" or "STUDIO10 · 10% off"
  code: string | null // null for automatic discounts
  automatic: boolean
  amount: number // merchandise discount (0 for free shipping)
  freeShipping: boolean
}

export interface CartLine {
  lineId: string
  productId: string
  /** The exact variant (SKU) of this line */
  variantId?: string
  name: string
  category: string
  /** Category and colour names in the request language (display; `category` / `color` stay English) */
  categoryLabel?: string
  colorLabel?: string | null
  type: ProductType
  sku: string
  color: string | null
  size: string | null
  options: Record<string, string>
  qty: number
  unit: number
  total: number
  inventory: number | null
  digital: boolean
  image: Photo
  alt: string
  discount: number // allocated share of the bag's discounts; `total` stays before discounts
  /** The product can be ordered past zero stock (made to order) */
  backorder?: boolean
}

export interface Totals {
  subtotal: number
  discount: number // sum of all applied discounts
  discountCode: string | null // the entered code, when it applied
  discounts: AppliedDiscountSummary[]
  shipping: number
  shippingLabel: string // "Free" | "$12" | "No shipping · digital"
  tax: number
  taxName: string // "VAT"
  taxRate: number // 0.25
  total: number
  toFree: number // left to free shipping
  freeThreshold: number
  count: number // total units
  physical: boolean
  /** true: prices already include tax (tax is extracted, not added); false: tax is added at checkout */
  pricesIncludeTax: boolean
  /** "Includes $29.60 VAT" (inclusive) or "VAT 25%" (exclusive) */
  taxLabel: string
  /** GET /cart/totals only: each line's discount at the selected shipping rate (lineId → amount) */
  lineDiscounts?: Record<string, number>
  /** GET /cart/totals only: why the stored code isn't applying at the selected rate and email */
  discountError?: { code: string; message: string } | null
}

/** Checkout context for POST /site-api/cart/discount (all optional; the bag page sends none) */
export interface DiscountContext {
  country?: string
  method?: string
  email?: string
}

export interface Cart {
  id: string
  lines: CartLine[]
  discountCode: string | null
  discountNote: string | null // "10% off" etc.
  /** Why the stored code isn't applying right now (minimum not reached, better offer applied…) */
  discountError: { code: string; message: string } | null
  totals: Totals
}

/** Storefront view of a discount code */
export interface Discount {
  code: string
  kind: 'percent' | 'fixed' | 'shipping'
  value: number
  label: string
  minimum: number
  note: string
}

/** POST /site-api/cart/items */
export interface AddToCartInput {
  productId: string
  /** The exact variant chosen on the product page (required for custom options) */
  variantId?: string | null
  color?: string | null
  size?: string | null
  qty: number
}

/** POST /site-api/cart/email: the checkout email, so an abandoned bag can be reminded (WP-09 / WP-24) */
export interface CartEmailInput {
  email: string
}

/** POST /site-api/wishlist, DELETE /site-api/wishlist/:productId */
export interface WishlistIds {
  ids: string[]
}
