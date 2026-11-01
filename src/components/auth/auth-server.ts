/* SERVER side of the sign-in pages (WP-15): the `auth` strings for the page's language, the copy block the
   page scripts read, and VAREL's `<terms>…</terms>` rich strings. Never import from a browser script. */
import type { Dictionary } from '../../lib/i18n/core'
import { DEFAULT_LOCALE, localizedPath } from '../../lib/i18n/locales'
import { catalog, hasCatalogs, tFor } from '../../lib/i18n/server'

export { tFor }

/** Only the `auth` namespace (and English as the fallback): small enough to send with the page. */
export function authDictionary(locale: string): Dictionary {
  const lang = hasCatalogs(locale) ? locale : DEFAULT_LOCALE
  const own = catalog(lang, 'auth') ?? {}
  if (lang === DEFAULT_LOCALE) return { locale: lang, catalogs: { auth: own } }
  return { locale: lang, catalogs: { auth: own }, fallback: { auth: catalog(DEFAULT_LOCALE, 'auth') ?? {} } }
}

export type RichPart = { text: string; href?: string }

/**
 * "By signing in you agree to our <terms>terms</terms> and <privacy>privacy policy</privacy>." →
 * text and link parts (rendered as text nodes and `<a>`, never as HTML). Unknown tags stay text.
 */
export function richParts(text: string, links: Record<string, string>): RichPart[] {
  const parts: RichPart[] = []
  const re = /<(\w+)>(.*?)<\/\1>/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    const href = links[m[1]!]
    parts.push(href ? { text: m[2]!, href } : { text: m[2]! })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** The page's paths in its language (`/da/account/login/`). */
export const pathIn = (locale: string) => (path: string) => localizedPath(path, locale)

/** The legal links VAREL's auth pages show. */
export const legalLinks = (locale: string) => ({ terms: localizedPath('/terms/', locale), privacy: localizedPath('/privacy/', locale) })
