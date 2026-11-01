/* The customer's account (VAREL src/lib/api/types.ts + endpoints.ts + privacy.ts).
   Routes: /site-api/account (account.ts, WP-13), PATCH /site-api/account/locale (i18n.ts, WP-15),
   /site-api/downloads (downloads.ts, WP-13), /site-api/newsletter (newsletter.ts, WP-20).

   D5: sign-in, password, email change, sessions and account deletion are the TEMPLATE's
   (`/site-api/auth/*`, `/account/*` pages); VAREL's `/api/auth/*` is not ported. The profile fields
   live in `CustomerProfile` keyed by the template user id. Roles and abilities come from `/site-api/me`. */
import type { Order } from './orders'

export interface Address {
  id: string
  label: string | null
  name: string
  line1: string
  line2: string | null
  city: string
  /** State / province / county code where the country's addresses carry one */
  region?: string | null
  zip: string
  country: string
  phone: string | null
  primary: boolean
}

export type AddressInput = Omit<Address, 'id'>

/** The signed-in customer (VAREL `User` minus role/permissions: those are the template's `/me`). */
export interface AccountUser {
  id: string // template user id, as a string
  firstName: string
  lastName: string
  name: string
  email: string
  phone: string | null
  since: string // "March 2024"
  newsletter: boolean
  /** Remembered storefront language (emails use it) */
  locale: string | null
  marketingOptIn?: boolean
}

/** VAREL's name for the same shape. */
export type User = AccountUser

/** PATCH /site-api/account/profile. Email changes go through the template's confirm-email flow. */
export interface ProfileInput {
  firstName: string
  lastName: string
  phone?: string | null
}

/** PATCH /site-api/account/preferences */
export interface PreferencesInput {
  newsletter: boolean
}

/** PATCH /site-api/account/locale */
export interface LocaleInput {
  locale?: string
}

export interface Download {
  name: string
  file: string
  orderNumber: string
}

/** GET /site-api/account/overview */
export interface AccountOverview {
  user: AccountUser
  addresses: Address[]
  recentOrders: Order[]
  wishlistCount: number
  downloads: Download[]
}

/** POST /site-api/newsletter */
export interface NewsletterInput {
  email: string
  source?: string
}

/** GET /site-api/account/export (and the admin's customer export): `varel-customer-export/1` */
export interface CustomerExport {
  exportedAt: string
  format: 'varel-customer-export/1'
  profile: Record<string, unknown>
  newsletter: { subscribed: boolean; since: string | null; source: string | null }
  addresses: Address[]
  orders: Order[]
  returns: Record<string, unknown>[]
  reviews: Record<string, unknown>[]
  wishlist: string[]
  messages: Record<string, unknown>[]
  totals: { orders: number; spent: number }
}

/** POST /site-api/account/onboarding: after the first sign-in (WP-15). */
export interface OnboardingResult {
  profileCreated: boolean
  subscribed: boolean
  merged: boolean
}
