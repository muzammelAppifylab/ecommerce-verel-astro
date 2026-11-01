/* Admin store settings: settings, tax rates, shipping, payments (VAREL src/lib/admin/types.ts, store.ts).
   Routes: /site-api/manage/settings, /manage/tax-rates, /manage/shipping, /manage/payments (WP-23). */
import type { HomeHero, SocialNetwork } from '../settings'

export interface AdminShippingMethod {
  id: string // "denmark-express"
  name: string
  detail: string
  rate: number
  position: number
}

export interface AdminShippingZone {
  id: string
  zone: string // "Denmark" | "European Union" | "Rest of world"
  countries: string[] // empty for the catch-all zone
  position: number
  methods: AdminShippingMethod[]
}

/** POST/PATCH /site-api/manage/shipping/zones */
export interface ZoneInput {
  zone: string
  countries: string[]
  position?: number
}

/** POST /site-api/manage/shipping/zones/:id/methods, PATCH /manage/shipping/methods/:id */
export interface MethodInput {
  name: string
  detail: string
  rate: number
  position?: number
}

export type EmailProvider = 'outbox' | 'resend' | 'postmark' | 'ezystudio' | 'webhook'
export type TranslationProvider = 'workers-ai' | 'deepl' | 'none'

/** Every Setting column (docs/PHASE2-3.md). PATCH /site-api/manage/settings accepts any subset. */
export interface StoreSettings {
  storeName: string // "VAREL"
  currency: string // ISO 4217: USD, EUR, DKK, GBP, SEK, NOK…
  taxName: string // "VAT"
  taxRate: number // 0.25 — default when no country rate matches
  freeShippingThreshold: number // 150
  announcement: string // announcement bar text
  supportEmail: string
  lowStockThreshold: number // 6: variant/product stock at or below this (and above 0) is "low"
  returnWindowDays: number // 30: days after delivery a return can be requested
  // tax
  pricesIncludeTax: boolean
  taxDigital: boolean
  taxShipping: boolean
  // general
  legalName: string
  vatNumber: string
  businessAddress: string
  phone: string
  logoUrl: string | null
  socialLinks: Partial<Record<SocialNetwork, string>>
  orderPrefix: string // "VRL-"
  // checkout
  guestCheckout: boolean
  requirePhone: boolean
  orderNotes: boolean
  termsText: string
  // inventory & returns
  hideSoldOut: boolean
  returnReasons: string[]
  refundShipping: boolean
  // payments
  paymentProvider: 'stripe' | 'simulated'
  stripePublishableKey: string | null
  // email
  emailProvider: EmailProvider
  emailConfig: { endpoint?: string; messageStream?: string } & Record<string, string | undefined>
  emailFromName: string
  emailFromAddress: string
  emailReplyTo: string | null
  staffAlertEmail: string | null
  // seo & content
  seoTitle: string
  seoDescription: string
  ogImage: string | null
  homeHero: HomeHero
  // customers & privacy
  cookieConsent: boolean
  abandonedCartEnabled: boolean
  abandonedCartHours: number
  reviewsEnabled: boolean
  reviewsRequireApproval: boolean
  reviewsVerifiedOnly: boolean
  analyticsEnabled: boolean
  // languages (docs/I18N.md)
  defaultLocale: string // "en": the source language of all content
  locales: string[] // enabled storefront languages, default first, e.g. ["en","da","de","fr","es","sv"]
  translationProvider: TranslationProvider
  autoTranslate: boolean // machine-translate content when it is saved
  /** Read-only: whether the owner added the matching secrets (`config.ownerSecret`), never the secrets themselves */
  secrets: {
    /** STRIPE_SECRET_KEY */
    stripeSecretKey: boolean
    /** STRIPE_WEBHOOK_SECRET */
    stripeWebhookSecret: boolean
    /** EMAIL_API_KEY */
    emailApiKey: boolean
    /** CF_ACCOUNT_ID + CF_AI_TOKEN */
    workersAi: boolean
    /** DEEPL_API_KEY */
    deepl: boolean
  }
}

/** PATCH body: any subset, `secrets` ignored */
export type StoreSettingsInput = Partial<Omit<StoreSettings, 'secrets'>>

export interface AdminTaxRate {
  id: string
  country: string // "Denmark"
  rate: number // 0.25
  name: string // "VAT"
}

/** POST/PATCH /site-api/manage/tax-rates */
export interface TaxRateInput {
  country: string
  rate: number
  name?: string
}

/** GET /site-api/manage/payments/status. Keys are never returned, only whether they are set and their mode. */
export interface AdminPaymentsStatus {
  /** What checkout uses right now (simulated whenever Stripe isn't fully configured) */
  active: 'stripe' | 'simulated'
  /** What the settings select */
  selected: 'stripe' | 'simulated'
  secretKey: { set: boolean; mode: 'test' | 'live' | null }
  webhookSecret: { set: boolean }
  publishableKey: { set: boolean; mode: 'test' | 'live' | null }
  /** Register this endpoint in the Stripe dashboard (/site-api/webhooks/stripe) */
  webhookUrl: string
  webhookEvents: string[]
  /** STRIPE_API_HOST is set (stripe-mock, tests only) */
  apiHostOverride: boolean
}
