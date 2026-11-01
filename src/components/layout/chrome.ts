/*
 * SERVER ONLY: everything the storefront chrome (announcement bar, header, footer, cookie banner, language
 * switcher) needs, read once per page through the in-process Site API and turned into plain props.
 *
 *   const chrome = await loadChrome(api, {locale, pathname, signedIn});
 *
 * Reads `GET /site-api/settings/public` (VAREL PublicSettings, WP-01) and `GET /site-api/menus` (WP-01). Either
 * may fail or be missing: the chrome then shows VAREL's built-in copy and menus, exactly as VAREL did while
 * those requests loaded or failed.
 */
import {DEFAULT_LOCALE, SHIPPED_LOCALES, localizeHref, stripLocale} from '@/components/varel/href';
import type {Dicts} from '@/components/varel/text';
import {read} from '@/server/backend';

import {dictsFor, serverText} from './dictionaries';
import {FOOTER_MENU_KEYS, isMenuList, type Menu, type ResolvedMenu, resolveMenu} from './menus';

/** The public settings fields the chrome reads (a subset of VAREL `PublicSettings`). */
export interface ChromeSettings {
  storeName?: string;
  currency?: string;
  announcement?: string;
  supportEmail?: string;
  phone?: string;
  legalName?: string;
  vatNumber?: string;
  businessAddress?: string;
  socialLinks?: Partial<Record<SocialKey, string>>;
  cookieConsent?: boolean;
  analyticsEnabled?: boolean;
  defaultLocale?: string;
  locales?: string[];
}

export type SocialKey = 'instagram' | 'pinterest' | 'tiktok' | 'facebook' | 'x';

const SOCIAL_LABELS: Record<SocialKey, string> = {
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  x: 'X',
};

const DEFAULT_SOCIALS = [
  {label: 'Instagram', href: 'https://www.instagram.com/'},
  {label: 'Pinterest', href: 'https://www.pinterest.com/'},
];

/** Fallbacks (VAREL src/lib/studio-contact.ts): equal to the seeded settings. */
export const STUDIO_EMAIL = 'care@varel.studio';
export const STUDIO_PHONE = '(+45) 00 00 20 40';

/** Native names for the language switcher (VAREL src/lib/i18n/locales.ts LOCALE_NAMES). */
export const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  da: 'Dansk',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  sv: 'Svenska',
  nb: 'Norsk',
  nl: 'Nederlands',
  it: 'Italiano',
  fi: 'Suomi',
  pt: 'Português',
  pl: 'Polski',
};

export interface LanguageOption {
  code: string;
  name: string;
  /** The current page in that language */
  href: string;
}

/** Plain data for the chrome islands (serialisable: Astro passes it to the browser). */
export interface Chrome {
  locale: string;
  /** The page path without a language prefix (`/shop/women/`) */
  path: string;
  signedIn: boolean;
  /** `null` = hidden (the setting is empty) */
  announcement: string | null;
  cookieConsent: boolean | undefined;
  header: ResolvedMenu;
  footer: ResolvedMenu[];
  socials: {label: string; href: string}[];
  contact: {email: string; phone: string; phoneHref: string; addressLines: string[] | null};
  /** "VAREL ApS · VAT DK12345678", or '' */
  legal: string;
  languages: LanguageOption[];
  /** Localized hrefs the chrome links to */
  links: {
    home: string;
    shop: string;
    search: string;
    account: string;
    signIn: string;
    wishlist: string;
    cart: string;
    checkout: string;
    privacy: string;
    terms: string;
  };
  /** Catalogs for the islands: header + menus + bag (layout, i18n, common), cookie banner (privacy), newsletter (journal) */
  dicts: Dicts;
  currency: string;
}

const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
const norm = (v: string | null | undefined) => v?.trim().toLowerCase().split(/[-_]/)[0] || null;

/** Enabled storefront languages in the store's order (default first), limited to codes we can route. */
export function enabledLocales(settings: ChromeSettings | null): string[] {
  const list = [
    ...new Set((settings?.locales ?? []).map(norm).filter((c): c is string => !!c && /^[a-z]{2,3}$/.test(c))),
  ];
  return list.length ? list : [...SHIPPED_LOCALES];
}

type Getter = {$get: (args?: unknown, opts?: {headers?: Record<string, string>}) => Promise<Response>};

/** Read the public settings and menus through the in-process Site API (`backend(request)` / `pageContext().api`). */
export async function readChromeData(api: unknown, locale: string) {
  const client = api as {settings: {public: Getter}; menus: Getter};
  const headers = {'x-locale': locale};
  const [settings, menus] = await Promise.all([
    read<ChromeSettings>(client.settings.public.$get(undefined, {headers})),
    read<unknown>(client.menus.$get(undefined, {headers})),
  ]);
  return {
    settings: settings && typeof settings === 'object' ? settings : null,
    menus: isMenuList(menus) ? (menus as Menu[]) : null,
  };
}

/** Build the chrome props for one page. */
export function buildChrome({
  settings,
  menus,
  locale = DEFAULT_LOCALE,
  pathname,
  search = '',
  signedIn,
}: {
  settings: ChromeSettings | null;
  menus: Menu[] | null;
  locale?: string;
  pathname: string;
  search?: string;
  signedIn: boolean;
}): Chrome {
  const t = serverText(locale);
  const tl = (key: string, vars?: Record<string, string | number>) => t('layout', key, vars);
  const path = stripLocale(pathname);
  const href = (p: string) => localizeHref(locale, p);

  const socials = (Object.keys(SOCIAL_LABELS) as SocialKey[])
    .filter(k => settings?.socialLinks?.[k])
    .map(k => ({label: SOCIAL_LABELS[k], href: settings!.socialLinks![k]!}));

  const email = settings?.supportEmail?.trim() || STUDIO_EMAIL;
  const phone = settings?.phone?.trim() || STUDIO_PHONE;
  const address = settings?.businessAddress?.trim();
  const addressLines = address
    ? address
        .split(/\n|,\s*(?=\d)/)
        .map(l => l.trim())
        .filter(Boolean)
    : null;
  const legal = [settings?.legalName, settings?.vatNumber ? tl('footer.vat', {number: settings.vatNumber}) : null]
    .filter(Boolean)
    .join(' · ');

  const languages = enabledLocales(settings).map(code => ({
    code,
    name: LOCALE_NAMES[code] ?? code.toUpperCase(),
    href: localizeHref(code, `${path}${search}`),
  }));

  return {
    locale,
    path,
    signedIn,
    announcement: settings ? settings.announcement?.trim() || null : tl('announcement.fallback'),
    cookieConsent: settings?.cookieConsent,
    header: resolveMenu(menus, 'header', locale, tl),
    footer: FOOTER_MENU_KEYS.map(key => resolveMenu(menus, key, locale, tl)),
    socials: socials.length ? socials : DEFAULT_SOCIALS,
    contact: {email, phone, phoneHref: telOf(phone), addressLines},
    legal,
    languages,
    links: {
      home: href('/'),
      shop: href('/shop'),
      search: href('/search'),
      account: href('/account'),
      signIn: href('/account/login'),
      wishlist: href('/wishlist'),
      cart: href('/cart'),
      checkout: href('/checkout'),
      privacy: href('/privacy'),
      terms: href('/terms'),
    },
    dicts: dictsFor(locale, {
      layout: true,
      i18n: true,
      common: true,
      privacy: ['banner', 'dialog', 'settingsLink'],
      journal: ['newsletterForm'],
    }),
    currency: settings?.currency ?? 'USD',
  };
}
