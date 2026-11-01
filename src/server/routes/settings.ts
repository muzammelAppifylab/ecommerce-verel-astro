import {type Context, Hono} from 'hono';

import type {Prisma} from '../../generated/prisma/client';
import type {HomeHero, PublicSettings} from '../../lib/types/settings';
import {withDb} from '../../platform/guards';
import type {Db} from '../lib/db';
import {loadFor, makeLoc, type TranslationMap, tr, trJson} from '../lib/i18n/localize';
import {LOCALE_HEADER, localeOf, localeSettings, withLocale} from '../lib/locale';
import {fromCents, setStoreCurrency} from '../lib/money';
import {getSettings, publicSettingsOf, SETTINGS_ID} from '../lib/settings';

/**
 * Store settings (public). WP-01. Port of VAREL worker/routes/misc.ts (GET /settings/public).
 *
 *   GET    /site-api/settings/public                   PublicSettings (src/lib/types/settings.ts); visitor-independent
 *
 * Public, no viewer (it would force `private, no-store`), no writes except the one-time defaults row
 * (F4 `getSettings`) when the database has none. Input: only `lang`, read by `localeOf`, which accepts
 * nothing but an enabled locale (anything else is ignored, never 422, as in VAREL). No body.
 * Guards: withDb (503 `site_database_disabled`) → withLocale.
 */

/** Exactly the columns `PublicSettings` is built from (never secrets, email config, order prefix…). */
export const PUBLIC_SELECT = {
  storeName: true,
  currency: true,
  pricesIncludeTax: true,
  taxName: true,
  taxRate: true,
  freeShippingThresholdCents: true,
  announcement: true,
  supportEmail: true,
  phone: true,
  legalName: true,
  vatNumber: true,
  businessAddress: true,
  logoUrl: true,
  socialLinks: true,
  guestCheckout: true,
  requirePhone: true,
  orderNotes: true,
  termsText: true,
  hideSoldOut: true,
  returnWindowDays: true,
  returnReasons: true,
  paymentProvider: true,
  stripePublishableKey: true,
  seoTitle: true,
  seoDescription: true,
  ogImage: true,
  homeHero: true,
  cookieConsent: true,
  reviewsEnabled: true,
  analyticsEnabled: true,
  defaultLocale: true,
  locales: true,
} satisfies Prisma.SettingSelect;

export type PublicSettingRow = Prisma.SettingGetPayload<{select: typeof PUBLIC_SELECT}>;

const SOCIAL_KEYS = ['instagram', 'pinterest', 'tiktok', 'facebook', 'x'] as const;

const plainObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The row → wire mapping (same as F4 `serializeSettings` + `publicSettingsOf`, field by field). */
export function publicFromRow(s: PublicSettingRow): PublicSettings {
  const social = plainObject(s.socialLinks) ?? {};
  const socialLinks: PublicSettings['socialLinks'] = {};
  for (const k of SOCIAL_KEYS) if (typeof social[k] === 'string' && social[k]) socialLinks[k] = social[k] as string;
  const def = s.defaultLocale || 'en';
  return {
    storeName: s.storeName,
    currency: s.currency,
    pricesIncludeTax: s.pricesIncludeTax,
    taxName: s.taxName,
    taxRate: Number(s.taxRate.toString()),
    freeShippingThreshold: fromCents(s.freeShippingThresholdCents),
    announcement: s.announcement,
    supportEmail: s.supportEmail,
    phone: s.phone,
    legalName: s.legalName,
    vatNumber: s.vatNumber,
    businessAddress: s.businessAddress,
    logoUrl: s.logoUrl,
    socialLinks,
    guestCheckout: s.guestCheckout,
    requirePhone: s.requirePhone,
    orderNotes: s.orderNotes,
    termsText: s.termsText,
    hideSoldOut: s.hideSoldOut,
    returnWindowDays: s.returnWindowDays,
    returnReasons: s.returnReasons,
    paymentProvider: s.paymentProvider === 'stripe' ? 'stripe' : 'simulated',
    stripePublishableKey: s.stripePublishableKey,
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    ogImage: s.ogImage,
    homeHero: (plainObject(s.homeHero) ?? {}) as HomeHero,
    cookieConsent: s.cookieConsent,
    reviewsEnabled: s.reviewsEnabled,
    analyticsEnabled: s.analyticsEnabled,
    defaultLocale: def,
    locales: [def, ...s.locales.filter(l => l !== def)],
  };
}

/** Setting fields with translations (entity `setting`, id "1"). */
export const TRANSLATED_FIELDS = ['announcement', 'termsText', 'returnReasons', 'homeHero', 'seoTitle', 'seoDescription'];

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * A translated hero over the source one: only the WORDS come from the translation (eyebrow, title, body,
 * CTA labels); CTA urls and the image always stay the source's. VAREL's comment said so, but its spread
 * let a translated `url` win: this is the stricter version (hand-off note).
 */
export function mergeHero(source: HomeHero, translated: unknown): HomeHero {
  const t = plainObject(translated);
  if (!t) return source;
  const out: HomeHero = {...source};
  for (const key of ['eyebrow', 'title', 'body'] as const) {
    const v = text(t[key]);
    if (v !== undefined) out[key] = v;
  }
  for (const key of ['primaryCta', 'secondaryCta'] as const) {
    const label = text(plainObject(t[key])?.label);
    const src = source[key];
    if (label !== undefined && src) out[key] = {label, url: src.url};
  }
  return out;
}

/** The source settings in the request language (`m` = that language's `setting` translations). */
export function overlaySettings(s: PublicSettings, m: TranslationMap): PublicSettings {
  if (!m.size) return s;
  const reasons = trJson<unknown>(m, '1', 'returnReasons', s.returnReasons);
  return {
    ...s,
    announcement: tr(m, '1', 'announcement', s.announcement),
    termsText: tr(m, '1', 'termsText', s.termsText),
    returnReasons:
      Array.isArray(reasons) && reasons.every(r => typeof r === 'string') ? (reasons as string[]) : s.returnReasons,
    homeHero: mergeHero(s.homeHero, trJson<unknown>(m, '1', 'homeHero', null)),
    seoTitle: tr(m, '1', 'seoTitle', s.seoTitle),
    seoDescription: tr(m, '1', 'seoDescription', s.seoDescription),
  };
}

/** PublicSettings in the source language, creating the defaults row once if it is missing. */
export async function readPublicSettings(db: Db): Promise<PublicSettings> {
  const row = await db.setting.findUnique({where: {id: SETTINGS_ID}, select: PUBLIC_SELECT});
  if (!row) return publicSettingsOf(await getSettings(db));
  // As VAREL's getSettings did: money() on this isolate formats in the store currency.
  setStoreCurrency(row.currency);
  return publicFromRow(row);
}

/**
 * Visitor-independent answers may be cached briefly (performance.md: short max-age on SSR data). When the
 * language came from the `X-Locale` header (pages, islands) a shared cache keyed on it is safe; otherwise it
 * came from `?lang`, the cookie or Accept-Language, so only the browser may keep it.
 */
export async function cacheByLocale(c: Context, db: Db): Promise<void> {
  const header = c.req.header(LOCALE_HEADER)?.trim().toLowerCase();
  const {locales} = await localeSettings(db);
  if (header && locales.includes(header)) {
    c.header('Cache-Control', 'public, max-age=60');
    c.header('Vary', 'X-Locale');
  } else {
    c.header('Cache-Control', 'private, max-age=60');
    c.header('Vary', 'Accept-Language, Cookie');
  }
}

/** Mounted at `/site-api/settings` (src/server/app.ts). */
export const settingsRoutes = new Hono().get('/public', withDb, withLocale, async c => {
  const db = c.var.db;
  const source = await readPublicSettings(db);
  const loc = makeLoc(await localeOf(c), source.defaultLocale || 'en');
  const m = await loadFor(db, loc, 'setting', ['1'], TRANSLATED_FIELDS);
  await cacheByLocale(c, db);
  return c.json(overlaySettings(source, m));
});
