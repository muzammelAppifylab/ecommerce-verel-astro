/* The API contract types the shared libraries produce (F3's src/lib/types, one file per area), gathered under
   VAREL's old single-module names so the ported serializers keep their `T.Product` / `T.Cart` spelling. */
export type { Photo, Problem } from '../../lib/types/common'
export type { Facet, Product, ProductListResponse, ProductOption, ProductType, StockState, Variant } from '../../lib/types/catalog'
export type { AppliedDiscountSummary, Cart, CartLine, Totals } from '../../lib/types/cart'
export type { Post, PostBlock, PostDetail } from '../../lib/types/content'
export type { AccountUser, Address, User } from '../../lib/types/account'
export type { FulfillmentStatus, Order, OrderItem, PaymentStatus, ShippingMethod, ShippingZone } from '../../lib/types/orders'
export type { HomeHero, PublicSettings } from '../../lib/types/settings'
export type { AdminTaxRate, StoreSettings } from '../../lib/types/admin/store'
