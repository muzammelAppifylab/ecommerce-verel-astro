/**
 * Store settings limits, shared by the server validator (`src/server/routes/admin/settings.ts`)
 * and the settings screens, so client rules mirror the server's exactly (AGENTS.md).
 * Pure constants: no imports (the route and the browser bundle both load it).
 *
 * VAREL's client and server disagreed in a few places; the stricter, column-safe value won
 * (docs/migration/handoff/WP-23.md).
 */
export const SETTINGS_LIMITS = {
  storeName: 80,
  announcement: 160,
  legalName: 120,
  vatNumber: 40,
  businessAddress: 300,
  phone: 40,
  /** Optional phone: digits, spaces and + ( ) . - only. */
  phonePattern: /^[+()\d\s.-]{5,24}$/,
  imageLink: 2000,
  socialLink: 300,
  orderPrefix: 10,
  taxName: 40,
  freeShippingThreshold: 1_000_000,
  termsText: 500,
  lowStockThreshold: 1000,
  returnWindowDays: 365,
  returnReasons: 12,
  returnReason: 80,
  stripePublishableKey: 255,
  emailConfigKeys: 10,
  emailConfigValue: 500,
  emailFromName: 80,
  seoTitle: 120,
  seoDescription: 320,
  abandonedCartHoursMin: 1,
  abandonedCartHoursMax: 720,
  locales: 30,
  /** Tax rates: a fraction 0–1 with 4 decimals (25 % = 0.25). */
  rateDecimals: 4,
  /** Shipping. */
  zoneName: 80,
  zoneCountries: 250,
  methodName: 60,
  methodDetail: 80,
  methodRate: 10_000,
  position: 10_000,
} as const;

/** An https link or a site path (`/images/logo.png`), never `//host` or `http://`. */
export const IMAGE_LINK_RE = /^(https:\/\/\S+|\/(?!\/)\S*)$/i;
/** A full web link (social profiles). */
export const WEB_LINK_RE = /^https?:\/\/\S+$/i;
/** Stripe publishable key. */
export const PUBLISHABLE_KEY_RE = /^pk_(test|live)_[A-Za-z0-9]+$/;
/** Order prefix: letters, digits, dashes; must end in a non-digit so numbers stay parseable. */
export const ORDER_PREFIX_RE = /^[A-Z0-9-]+$/;

export const SOCIAL_NETWORKS = ['instagram', 'pinterest', 'tiktok', 'facebook', 'x'] as const;
