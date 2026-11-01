/* Public store settings for the storefront (chrome, money formatting, checkout rules, SEO defaults).
   GET /site-api/settings/public (settings.ts, WP-01) — VAREL src/lib/api/settings.ts. Never contains secrets. */
import type { Photo } from './common'

export interface HomeHero {
  eyebrow?: string
  title?: string
  body?: string
  primaryCta?: { label: string; url: string }
  secondaryCta?: { label: string; url: string }
  image?: Photo
}

export type SocialNetwork = 'instagram' | 'pinterest' | 'tiktok' | 'facebook' | 'x'

export interface PublicSettings {
  storeName: string
  /** ISO 4217 code, e.g. "USD", "EUR", "DKK", "GBP" */
  currency: string
  /** true: catalog prices already include tax (shown "incl. VAT"); false: tax is added at checkout */
  pricesIncludeTax: boolean
  taxName: string // "VAT"
  taxRate: number // default rate, e.g. 0.25 (country rates may differ at checkout)
  freeShippingThreshold: number
  announcement: string
  supportEmail: string
  phone: string
  legalName: string
  vatNumber: string
  businessAddress: string
  logoUrl: string | null
  socialLinks: Partial<Record<SocialNetwork, string>>
  // checkout
  guestCheckout: boolean
  requirePhone: boolean
  orderNotes: boolean
  termsText: string
  // inventory & returns
  hideSoldOut: boolean
  returnWindowDays: number
  returnReasons: string[]
  // payments
  paymentProvider: 'stripe' | 'simulated'
  stripePublishableKey: string | null
  // seo & content
  seoTitle: string
  seoDescription: string
  ogImage: string | null
  homeHero: HomeHero
  // customers & privacy
  cookieConsent: boolean
  reviewsEnabled: boolean
  analyticsEnabled: boolean
  // languages (docs/I18N.md)
  defaultLocale: string // "en"
  locales: string[] // enabled storefront languages, default first
}
