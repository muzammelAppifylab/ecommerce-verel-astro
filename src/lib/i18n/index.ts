/* Storefront i18n, client-safe entry (PLAN.md D7). Replaces VAREL's i18next setup:
   - pages (server): `import { t, dictionary } from '@/lib/i18n/server'`, locale from `Astro.locals.locale`;
   - islands: receive `dict` as a prop, `import { useT } from '@/lib/i18n/react'`;
   - links: `localizedPath('/shop/', locale)`; the language switcher: `switchLocaleHref(...)` + `writeLocaleCookie`.
   The Site API learns the locale from the `X-Locale` header (`localeHeaders(locale)` for siteFetch). */
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, baseLocale, localizedPath, splitLocalePath } from './locales'

export * from './locales'
export * from './core'

/** Read a cookie in the browser (null on the server). */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]!) : null
}

/** Remember the language for a year (`varel_locale`, SameSite=Lax). A preference, not an auth cookie. */
export function writeLocaleCookie(code: string): void {
  if (typeof document === 'undefined') return
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(code)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`
}

/** The page's locale in the browser: `<html lang>` (set by Base.astro from Astro.locals.locale), else the URL prefix. */
export function currentLocale(): string {
  if (typeof document !== 'undefined') {
    const lang = baseLocale(document.documentElement.lang)
    if (lang) return lang
  }
  if (typeof location !== 'undefined') return splitLocalePath(location.pathname).locale ?? DEFAULT_LOCALE
  return DEFAULT_LOCALE
}

/** Headers that tell the Site API which language to answer in (merge into siteFetch's init.headers). */
export const localeHeaders = (locale: string = currentLocale()): Record<string, string> => ({ [LOCALE_HEADER]: locale })

/** The same page in another language: "/da/shop/?q=x" → "/de/shop/?q=x". */
export function switchLocaleHref(href: string, locale: string): string {
  const url = new URL(href, 'http://x')
  return `${localizedPath(url.pathname, locale)}${url.search}${url.hash}`
}
