/* Storefront languages (PLAN.md D7, port of VAREL src/lib/i18n/locales.ts).
   English is the default and has no URL prefix; every other shipped language is a path prefix (/da/, /de/ …)
   that src/middleware.ts strips (context.rewrite) so page files stay locale-agnostic. The store's enabled set
   (Setting.locales) narrows this list at runtime. Client-safe: no catalogs, no server imports. */

export const SHIPPED_LOCALES = ['en', 'da', 'de', 'fr', 'es', 'sv'] as const
export type ShippedLocale = (typeof SHIPPED_LOCALES)[number]

export const DEFAULT_LOCALE = 'en'
/** Remembers a visitor's explicit language choice (read by the Site API's locale resolution). */
export const LOCALE_COOKIE = 'varel_locale'
/** Request header carrying the page's locale to the Site API (in-process and from islands). */
export const LOCALE_HEADER = 'X-Locale'

/** Native names for the language switcher. */
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
}

/** BCP 47 tags for Intl formatting (numbers and dates). */
export const INTL_LOCALE: Record<string, string> = {
  en: 'en-US',
  da: 'da-DK',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  sv: 'sv-SE',
}

/** `<html lang>` / hreflang tag per language. */
export const HREFLANG: Record<string, string> = { en: 'en', da: 'da', de: 'de', fr: 'fr', es: 'es', sv: 'sv' }

/** "da-DK" / "DA_dk" / " da " → "da"; null when empty. */
export const baseLocale = (v: string | null | undefined): string | null => v?.trim().toLowerCase().split(/[-_]/)[0] || null

export const isShippedLocale = (v: string | null | undefined): v is ShippedLocale =>
  !!v && (SHIPPED_LOCALES as readonly string[]).includes(v)

/** Languages served under a path prefix (every shipped one except the default). */
export const PREFIXED_LOCALES: readonly string[] = SHIPPED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)

const PREFIX_RE = new RegExp(`^/(${PREFIXED_LOCALES.join('|')})(?=/|$)`)

/** Split a pathname into its locale prefix and the locale-agnostic path:
    "/da/shop/" → { locale: 'da', path: '/shop/' }, "/da" → { locale: 'da', path: '/' }, "/shop/" → { locale: null, path: '/shop/' }. */
export function splitLocalePath(pathname: string): { locale: string | null; path: string } {
  const m = PREFIX_RE.exec(pathname)
  if (!m) return { locale: null, path: pathname || '/' }
  return { locale: m[1]!, path: pathname.slice(m[0].length) || '/' }
}

/** "/shop/" in Danish → "/da/shop/"; the default language keeps the bare path. Absolute URLs and anchors pass through. */
export function localizedPath(path: string, locale: string | null | undefined): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path
  const { path: bare } = splitLocalePath(path)
  if (!locale || locale === DEFAULT_LOCALE || !PREFIXED_LOCALES.includes(locale)) return bare
  return bare === '/' ? `/${locale}/` : `/${locale}${bare}`
}

/** Paths that are never localised: the dashboard, the account sign-in pages, the APIs, files and feeds. */
const UNLOCALIZED = /^\/(dashboard|portal|site-api|api|__platform|_astro|_image|fonts|images|favicon|sitemap|robots\.txt|rss\.xml)(\/|$|\.)/

export const isLocalizablePath = (path: string) => !UNLOCALIZED.test(path)
