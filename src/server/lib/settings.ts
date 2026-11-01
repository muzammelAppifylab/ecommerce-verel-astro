/* Store settings (port of VAREL worker/lib/settings.ts): a singleton row (id 1). Business config the storefront
   reads at request time. Contract: StoreSettings / AdminTaxRate (admin) and PublicSettings (public), docs/PHASE2-3.md.
   Money columns are cents in the database (freeShippingThresholdCents), currency units in the API.
   Secret flags come from the owner's secrets (`config.ownerSecret`, PLAN.md D3/D9): never the values. */
import type { Prisma } from '../../generated/prisma/client'
import { config } from '../../platform/config'
import type { Db } from './db'
import { fromCents, setStoreCurrency, toCents } from './money'
import { setOrderPrefix } from './orders'
import type { AdminTaxRate, HomeHero, PublicSettings, StoreSettings } from './contract-types'

export type { StoreSettings }

export const SETTINGS_ID = 1

/** Defaults for a fresh database (the seed writes the same values). Everything else uses the column defaults. */
export const DEFAULT_SETTINGS = {
  storeName: 'VAREL',
  currency: 'USD',
  taxName: 'VAT',
  taxRate: 0.25,
  freeShippingThreshold: 150,
  announcement: 'Free shipping on orders over $150',
  supportEmail: 'care@varel.studio',
  lowStockThreshold: 6,
  returnWindowDays: 30,
}

type SettingRow = Prisma.SettingGetPayload<object>

/** Which owner secrets are set (booleans only). */
export interface SecretFlags {
  stripeSecretKey: boolean
  stripeWebhookSecret: boolean
  emailApiKey: boolean
  /** Workers AI over REST: CF_ACCOUNT_ID + CF_AI_TOKEN */
  workersAi: boolean
  deepl: boolean
}

const NO_SECRETS: SecretFlags = { stripeSecretKey: false, stripeWebhookSecret: false, emailApiKey: false, workersAi: false, deepl: false }

/** Read the owner's secrets as booleans (server only; never the values). */
export function ownerSecretFlags(): SecretFlags {
  const has = (name: string) => !!config.ownerSecret(name)
  return {
    stripeSecretKey: has('STRIPE_SECRET_KEY'),
    stripeWebhookSecret: has('STRIPE_WEBHOOK_SECRET'),
    emailApiKey: has('EMAIL_API_KEY'),
    workersAi: has('CF_ACCOUNT_ID') && has('CF_AI_TOKEN'),
    deepl: has('DEEPL_API_KEY'),
  }
}

const SOCIAL_KEYS = ['instagram', 'pinterest', 'tiktok', 'facebook', 'x'] as const

const obj = (v: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

function socialOf(v: Prisma.JsonValue): StoreSettings['socialLinks'] {
  const o = obj(v)
  const out: StoreSettings['socialLinks'] = {}
  for (const k of SOCIAL_KEYS) if (typeof o[k] === 'string' && o[k]) out[k] = o[k] as string
  return out
}

function stringsOf(v: Prisma.JsonValue): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(obj(v))) if (typeof x === 'string') out[k] = x
  return out
}

export function serializeSettings(s: SettingRow, secrets: SecretFlags = NO_SECRETS): StoreSettings {
  return {
    storeName: s.storeName,
    currency: s.currency,
    taxName: s.taxName,
    // taxRate keeps 4 decimals (e.g. 0.0825), not cents
    taxRate: Number(s.taxRate.toString()),
    freeShippingThreshold: fromCents(s.freeShippingThresholdCents),
    announcement: s.announcement,
    supportEmail: s.supportEmail,
    lowStockThreshold: s.lowStockThreshold,
    returnWindowDays: s.returnWindowDays,
    pricesIncludeTax: s.pricesIncludeTax,
    taxDigital: s.taxDigital,
    taxShipping: s.taxShipping,
    legalName: s.legalName,
    vatNumber: s.vatNumber,
    businessAddress: s.businessAddress,
    phone: s.phone,
    logoUrl: s.logoUrl,
    socialLinks: socialOf(s.socialLinks),
    orderPrefix: s.orderPrefix,
    guestCheckout: s.guestCheckout,
    requirePhone: s.requirePhone,
    orderNotes: s.orderNotes,
    termsText: s.termsText,
    hideSoldOut: s.hideSoldOut,
    returnReasons: s.returnReasons,
    refundShipping: s.refundShipping,
    paymentProvider: s.paymentProvider === 'stripe' ? 'stripe' : 'simulated',
    stripePublishableKey: s.stripePublishableKey,
    emailProvider: (['outbox', 'resend', 'postmark', 'ezystudio', 'webhook'] as const).find((p) => p === s.emailProvider) ?? 'outbox',
    emailConfig: stringsOf(s.emailConfig),
    emailFromName: s.emailFromName,
    emailFromAddress: s.emailFromAddress,
    emailReplyTo: s.emailReplyTo,
    staffAlertEmail: s.staffAlertEmail,
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    ogImage: s.ogImage,
    homeHero: obj(s.homeHero) as HomeHero,
    cookieConsent: s.cookieConsent,
    abandonedCartEnabled: s.abandonedCartEnabled,
    abandonedCartHours: s.abandonedCartHours,
    reviewsEnabled: s.reviewsEnabled,
    reviewsRequireApproval: s.reviewsRequireApproval,
    reviewsVerifiedOnly: s.reviewsVerifiedOnly,
    analyticsEnabled: s.analyticsEnabled,
    // Languages (docs/I18N.md)
    defaultLocale: s.defaultLocale || 'en',
    locales: [s.defaultLocale || 'en', ...s.locales.filter((l) => l !== (s.defaultLocale || 'en'))],
    translationProvider: (['workers-ai', 'deepl', 'none'] as const).find((p) => p === s.translationProvider) ?? 'workers-ai',
    autoTranslate: s.autoTranslate,
    secrets,
  }
}

/** The settings row, created with defaults if the database has none yet. Pass `secrets` (ownerSecretFlags()) for
    the admin's `secrets` booleans. */
export async function getSettings(db: Db, secrets?: SecretFlags): Promise<StoreSettings> {
  const row =
    (await db.setting.findUnique({ where: { id: SETTINGS_ID } })) ??
    (await db.setting.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        storeName: DEFAULT_SETTINGS.storeName,
        currency: DEFAULT_SETTINGS.currency,
        taxName: DEFAULT_SETTINGS.taxName,
        taxRate: DEFAULT_SETTINGS.taxRate,
        freeShippingThresholdCents: toCents(DEFAULT_SETTINGS.freeShippingThreshold),
        announcement: DEFAULT_SETTINGS.announcement,
        supportEmail: DEFAULT_SETTINGS.supportEmail,
        lowStockThreshold: DEFAULT_SETTINGS.lowStockThreshold,
        returnWindowDays: DEFAULT_SETTINGS.returnWindowDays,
      },
      update: {},
    }))
  setStoreCurrency(row.currency)
  setOrderPrefix(row.orderPrefix)
  return serializeSettings(row, secrets)
}

/** GET /site-api/settings/public: exactly PublicSettings, never secrets or internal config. */
export function publicSettingsOf(s: StoreSettings): PublicSettings {
  return {
    storeName: s.storeName,
    currency: s.currency,
    pricesIncludeTax: s.pricesIncludeTax,
    taxName: s.taxName,
    taxRate: s.taxRate,
    freeShippingThreshold: s.freeShippingThreshold,
    announcement: s.announcement,
    supportEmail: s.supportEmail,
    phone: s.phone,
    legalName: s.legalName,
    vatNumber: s.vatNumber,
    businessAddress: s.businessAddress,
    logoUrl: s.logoUrl,
    socialLinks: s.socialLinks,
    guestCheckout: s.guestCheckout,
    requirePhone: s.requirePhone,
    orderNotes: s.orderNotes,
    termsText: s.termsText,
    hideSoldOut: s.hideSoldOut,
    returnWindowDays: s.returnWindowDays,
    returnReasons: s.returnReasons, // empty: the return form keeps its free-text reason
    paymentProvider: s.paymentProvider,
    stripePublishableKey: s.stripePublishableKey,
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    ogImage: s.ogImage,
    homeHero: s.homeHero,
    cookieConsent: s.cookieConsent,
    reviewsEnabled: s.reviewsEnabled,
    analyticsEnabled: s.analyticsEnabled,
    defaultLocale: s.defaultLocale,
    locales: s.locales,
  }
}

// ─── Tax rates ──────────────────────────────────────────────────────────────

type TaxRateRow = Prisma.TaxRateGetPayload<object>

export const serializeTaxRate = (r: TaxRateRow): AdminTaxRate => ({
  id: String(r.id),
  country: r.country,
  rate: Number(r.rate.toString()),
  name: r.name,
})

export interface TaxConfig {
  rate: number
  name: string
  pricesIncludeTax: boolean
  taxDigital: boolean
  taxShipping: boolean
}

/** The tax that applies for a shipping country: an exact TaxRate.country match, else the default rate.
    Before an address exists (`country` empty), the default rate. */
export async function taxFor(db: Db, s: StoreSettings, country?: string | null): Promise<TaxConfig> {
  const base = { pricesIncludeTax: s.pricesIncludeTax, taxDigital: s.taxDigital, taxShipping: s.taxShipping }
  const c = country?.trim()
  if (c) {
    const r = await db.taxRate.findFirst({ where: { country: { equals: c, mode: 'insensitive' } }, select: { rate: true, name: true } })
    if (r) return { ...base, rate: Number(r.rate.toString()), name: r.name || s.taxName }
  }
  return { ...base, rate: s.taxRate, name: s.taxName }
}

/** What computeTotals needs from settings (tax from taxFor when a country is known). */
export const totalsConfig = (s: StoreSettings, tax?: TaxConfig) => ({
  tax: tax ?? { rate: s.taxRate, name: s.taxName, pricesIncludeTax: s.pricesIncludeTax, taxDigital: s.taxDigital, taxShipping: s.taxShipping },
  freeThreshold: s.freeShippingThreshold,
  currency: s.currency,
})
