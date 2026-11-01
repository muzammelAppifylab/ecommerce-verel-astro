import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import {requirePermission, withDb} from '../../../platform/guards';
import {
  IMAGE_LINK_RE,
  ORDER_PREFIX_RE,
  PUBLISHABLE_KEY_RE,
  SETTINGS_LIMITS as L,
  SOCIAL_NETWORKS,
  WEB_LINK_RE,
} from '../../../portal/screens/settings/limits';
import {invalid} from '../../lib/errors';
import {invalidateLocaleSettings} from '../../lib/locale';
import {isCurrencyCode, round2, setStoreCurrency, toCents} from '../../lib/money';
import {setOrderPrefix} from '../../lib/orders';
import {getSettings, ownerSecretFlags, serializeSettings, SETTINGS_ID} from '../../lib/settings';
import {emailField, json} from '../../lib/validate';
import {PERMISSIONS} from '../../permissions';

/**
 * Admin: Store settings (port of VAREL worker/routes/admin/settings.ts). One endpoint pair for every
 * settings screen; each screen PATCHes only the fields it changed.
 *
 *   GET    /site-api/manage/settings                   StoreSettings (secrets: booleans from config.ownerSecret)
 *   PATCH  /site-api/manage/settings                   StoreSettingsInput → StoreSettings
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (reads: any staff; writes: the settings area), then the activity log. PATCH adds its validator,
 * `requirePermission(STORE_SETTINGS_MANAGE)` and `withDb`.
 *
 * Limits are shared with the screens (`SETTINGS_LIMITS`, src/portal/screens/settings/limits.ts), so the
 * client rules mirror these exactly. `secrets` and unknown keys are stripped. Translations of store texts
 * are picked up by the hourly translations backfill (WP-25), not queued here.
 */

const text = (label: string, max: number) =>
  z.string({error: `Enter ${label}`}).trim().min(1, `Enter ${label}`).max(max, `Keep ${label} under ${max} characters`);
const freeText = (max: number, message = `Keep this under ${max} characters`) =>
  z.string({error: 'Check this field'}).trim().max(max, message);
const flag = z.boolean({error: 'Use true or false'});
const count = (min: number, max: number, message: string) =>
  z.coerce.number({error: message}).int(message).min(min, message).max(max, message);

/** An uploaded image (https) or a site path; '' or null clears it. */
const imageLink = (max: number) =>
  z
    .string({error: 'Enter a link'})
    .trim()
    .max(max, `Keep the link under ${max} characters`)
    .refine(v => !v || IMAGE_LINK_RE.test(v), 'Upload an image or paste an https:// link.')
    .nullish()
    .transform(v => v || null);

const optionalEmail = z.union([z.literal(''), z.null(), emailField]).transform(v => v || null);

const SOCIAL_LABELS: Record<(typeof SOCIAL_NETWORKS)[number], string> = {
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  x: 'X',
};
const socialLink = (label: string) =>
  z
    .string({error: `Enter the full ${label} link, starting with https://`})
    .trim()
    .max(L.socialLink, `Keep the link under ${L.socialLink} characters`)
    .refine(v => !v || WEB_LINK_RE.test(v), `Enter the full ${label} link, starting with https://`)
    .nullish()
    .transform(v => v || null);
const socialLinks = z
  .object(
    Object.fromEntries(SOCIAL_NETWORKS.map(k => [k, socialLink(SOCIAL_LABELS[k])])) as Record<
      (typeof SOCIAL_NETWORKS)[number],
      ReturnType<typeof socialLink>
    >
  )
  .partial()
  .strict()
  .transform(o => Object.fromEntries(Object.entries(o).filter(([, v]) => !!v)) as Record<string, string>);

const cta = z
  .object({label: text('a button label', 40), url: text('a link', 500)})
  .nullish()
  .transform(v => v ?? undefined);
const photo = z
  .object({
    src: text('an image link', 1000),
    credit: freeText(200).optional().default(''),
    creditHref: freeText(500).optional().default(''),
  })
  .nullish()
  .transform(v => v ?? undefined);
const homeHero = z.object({
  eyebrow: freeText(80).optional(),
  title: freeText(160).optional(),
  body: freeText(600).optional(),
  primaryCta: cta,
  secondaryCta: cta,
  image: photo,
});

/** ISO 639 language code, e.g. "da" (regions are not used for storefront languages). */
const localeCode = z
  .string({error: 'Enter a language code'})
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}$/, 'Use a two-letter language code, e.g. da or de');

const SUPPORTED_CURRENCIES = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : []);

const emailConfig = z
  .record(
    z.string().regex(/^[a-zA-Z]{1,40}$/, 'Use a setting name of letters only'),
    z.string().trim().max(L.emailConfigValue, `Keep this under ${L.emailConfigValue} characters`).optional()
  )
  .superRefine((o, ctx) => {
    if (Object.keys(o).length > L.emailConfigKeys) ctx.addIssue({code: 'custom', message: `Keep it to ${L.emailConfigKeys} settings or fewer`});
    if (o.endpoint && !/^https:\/\/\S+$/i.test(o.endpoint)) {
      ctx.addIssue({code: 'custom', path: ['endpoint'], message: 'Use a full link starting with https://'});
    }
  });

export const settingsPatch = z
  .object({
    // General
    storeName: z
      .string({error: 'Enter a store name'})
      .trim()
      .min(1, 'Enter a store name')
      .max(L.storeName, `Keep a store name under ${L.storeName} characters`),
    announcement: freeText(L.announcement, `Keep it under ${L.announcement} characters.`),
    supportEmail: emailField,
    legalName: freeText(L.legalName),
    vatNumber: freeText(L.vatNumber),
    businessAddress: freeText(L.businessAddress),
    phone: freeText(L.phone).refine(v => !v || L.phonePattern.test(v), 'Use digits, spaces and + ( ) - only.'),
    logoUrl: imageLink(L.imageLink),
    socialLinks,
    orderPrefix: z
      .string({error: 'Enter an order prefix'})
      .trim()
      .toUpperCase()
      .min(1, 'Enter an order prefix, e.g. VRL-')
      .max(L.orderPrefix, 'Keep the prefix under 10 characters')
      .regex(ORDER_PREFIX_RE, 'Use letters, digits and dashes only')
      .refine(v => /\D$/.test(v), 'End the prefix with a letter or a dash, e.g. VRL-'),
    // Tax and currency
    currency: z
      .string({error: 'Choose a currency'})
      .trim()
      .toUpperCase()
      .refine(
        v => /^[A-Z]{3}$/.test(v) && (SUPPORTED_CURRENCIES.size ? SUPPORTED_CURRENCIES.has(v) : isCurrencyCode(v)),
        'Use a three-letter ISO 4217 code, e.g. USD, EUR or DKK'
      ),
    taxName: text('a tax name', L.taxName),
    taxRate: z.coerce
      .number({error: 'Enter a percentage from 0 to 100.'})
      .min(0, 'Enter a percentage from 0 to 100.')
      .max(1, 'Enter a percentage from 0 to 100.')
      .transform(r => Math.round(r * 10_000) / 10_000),
    pricesIncludeTax: flag,
    taxDigital: flag,
    taxShipping: flag,
    freeShippingThreshold: z.coerce
      .number({error: 'Enter zero or more.'})
      .min(0, 'Enter zero or more.')
      .max(L.freeShippingThreshold, 'Enter zero or more.')
      .transform(round2),
    // Checkout
    guestCheckout: flag,
    requirePhone: flag,
    orderNotes: flag,
    termsText: freeText(L.termsText, `Keep it under ${L.termsText} characters.`),
    // Inventory and returns
    lowStockThreshold: count(0, L.lowStockThreshold, 'Enter a whole number, zero or more.'),
    hideSoldOut: flag,
    returnWindowDays: count(0, L.returnWindowDays, `Enter whole days from 0 to ${L.returnWindowDays}.`),
    returnReasons: z
      .array(
        z
          .string({error: 'Enter a reason'})
          .trim()
          .min(1, 'Enter a reason')
          .max(L.returnReason, `Keep each reason under ${L.returnReason} characters.`),
        {error: 'Use a list of reasons'}
      )
      .max(L.returnReasons, `Keep it to ${L.returnReasons} reasons or fewer`)
      .transform(list => list.filter((r, i) => list.findIndex(x => x.toLowerCase() === r.toLowerCase()) === i)),
    refundShipping: flag,
    // Payments (the secret key and webhook secret are owner secrets)
    paymentProvider: z.enum(['stripe', 'simulated'], {error: 'Choose Stripe or simulated'}),
    stripePublishableKey: z
      .string({error: 'Check this field'})
      .trim()
      .max(L.stripePublishableKey)
      .refine(v => !v || PUBLISHABLE_KEY_RE.test(v), 'Use a publishable key starting with pk_test_ or pk_live_.')
      .nullish()
      .transform(v => v || null),
    // Email (WP-22's delivery tab)
    emailProvider: z.enum(['outbox', 'resend', 'postmark', 'ezystudio', 'webhook'], {error: 'Choose an email provider'}),
    emailConfig,
    emailFromName: text('a sender name', L.emailFromName),
    emailFromAddress: emailField,
    emailReplyTo: optionalEmail,
    staffAlertEmail: optionalEmail,
    // SEO and content
    seoTitle: freeText(L.seoTitle, `Keep it under ${L.seoTitle} characters.`),
    seoDescription: freeText(L.seoDescription, `Keep it under ${L.seoDescription} characters.`),
    ogImage: imageLink(L.imageLink),
    homeHero,
    // Customers and privacy
    cookieConsent: flag,
    abandonedCartEnabled: flag,
    abandonedCartHours: count(L.abandonedCartHoursMin, L.abandonedCartHoursMax, 'Enter whole hours from 1 to 720.'),
    reviewsEnabled: flag,
    reviewsRequireApproval: flag,
    reviewsVerifiedOnly: flag,
    analyticsEnabled: flag,
    // Languages (WP-25's screen)
    defaultLocale: localeCode,
    locales: z
      .array(localeCode, {error: 'Use a list of language codes'})
      .min(1, 'Keep at least one language')
      .max(L.locales, `Keep it to ${L.locales} languages or fewer`)
      .transform(list => [...new Set(list)]),
    translationProvider: z.enum(['workers-ai', 'deepl', 'none'], {error: 'Choose Workers AI, DeepL or none'}),
    autoTranslate: flag,
  })
  .partial();

export type SettingsPatch = z.output<typeof settingsPatch>;

export const settingsAdmin = new Hono()
  .get('/', withDb, async c => {
    c.header('Cache-Control', 'private, no-store');
    return c.json(await getSettings(c.var.db, ownerSecretFlags()));
  })
  .patch('/', json(settingsPatch), requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE), withDb, async c => {
    const input = {...c.req.valid('json')};
    const db = c.var.db;
    c.header('Cache-Control', 'private, no-store');
    const before = await getSettings(db); // makes sure the row exists

    const localesChanged = input.defaultLocale !== undefined || input.locales !== undefined;
    if (localesChanged) {
      const def = input.defaultLocale ?? before.defaultLocale;
      const list = input.locales ?? before.locales;
      if (!list.includes(def)) throw invalid({[input.locales ? 'locales' : 'defaultLocale']: 'Enable the default language too'});
      // Keep the default first, as the storefront switcher shows it.
      input.locales = [def, ...list.filter(l => l !== def)];
    }

    // Stripe needs a publishable key (the Payments screen's rule, checked when either field is sent).
    if (input.paymentProvider !== undefined || input.stripePublishableKey !== undefined) {
      const provider = input.paymentProvider ?? before.paymentProvider;
      const pk = input.stripePublishableKey !== undefined ? input.stripePublishableKey : before.stripePublishableKey;
      if (provider === 'stripe' && !pk) throw invalid({stripePublishableKey: 'Stripe needs a publishable key.'});
    }

    const {socialLinks: social, emailConfig: mail, homeHero: hero, freeShippingThreshold, ...rest} = input;
    const data: Prisma.SettingUpdateInput = {...rest};
    if (social) data.socialLinks = social;
    if (mail) data.emailConfig = Object.fromEntries(Object.entries(mail).filter(([, v]) => v)) as Prisma.InputJsonObject;
    if (hero) data.homeHero = JSON.parse(JSON.stringify(hero)) as Prisma.InputJsonObject;
    if (freeShippingThreshold !== undefined) data.freeShippingThresholdCents = toCents(freeShippingThreshold);

    if (!Object.keys(data).length) return c.json({...before, secrets: ownerSecretFlags()});

    const row = await db.setting.update({where: {id: SETTINGS_ID}, data});
    setStoreCurrency(row.currency);
    setOrderPrefix(row.orderPrefix);
    if (localesChanged) invalidateLocaleSettings();
    return c.json(serializeSettings(row, ownerSecretFlags()));
  });
