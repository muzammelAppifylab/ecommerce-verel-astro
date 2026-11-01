/* Server side of the storefront strings (PLAN.md D7). Every shipped catalog (src/locales/<locale>/<ns>.json) is
   bundled into the Worker; pages translate with `t(locale, ns, key, vars)` and hand islands only the namespaces
   they render with `dictionary(locale, ns)` (passed as a prop, read with `useT(dict, ns)`).
   Never import this module from an island: it would ship every catalog to the browser. */
import { type Catalog, type Dictionary, makeT, translate, type TFunction, type TVars, translateValue } from './core'
import { DEFAULT_LOCALE } from './locales'

const PATH = /\/src\/locales\/([^/]+)\/([^/]+)\.json$/

const files = import.meta.glob<Catalog>('/src/locales/*/*.json', { eager: true, import: 'default' })

/** locale → namespace → catalog */
const CATALOGS: Record<string, Record<string, Catalog>> = {}
for (const [p, cat] of Object.entries(files)) {
  const m = PATH.exec(p)
  if (m) (CATALOGS[m[1]!] ??= {})[m[2]!] = cat
}

/** Namespaces the storefront uses (the English catalog files). */
export const NAMESPACES: string[] = Object.keys(CATALOGS[DEFAULT_LOCALE] ?? {}).sort()

/** Languages with shipped catalogs (English included). */
export const CATALOG_LOCALES: string[] = Object.keys(CATALOGS).sort()

export const hasCatalogs = (locale: string) => Object.hasOwn(CATALOGS, locale)

/** One shipped catalog, or null (unknown language or namespace). */
export function catalog(locale: string, ns: string): Catalog | null {
  return CATALOGS[locale]?.[ns] ?? null
}

/** The strings an island needs: `ns` (one or several namespaces) in `locale`, English as the fallback.
    Pass the result as a prop; it is plain JSON. `common` is always included. */
export function dictionary(locale: string, ns: string | string[]): Dictionary {
  const names = [...new Set(['common', ...(Array.isArray(ns) ? ns : [ns])])]
  const lang = hasCatalogs(locale) ? locale : DEFAULT_LOCALE
  const pick = (l: string) => Object.fromEntries(names.flatMap((n) => (CATALOGS[l]?.[n] ? [[n, CATALOGS[l]![n]!]] : [])))
  return lang === DEFAULT_LOCALE ? { locale: lang, catalogs: pick(lang) } : { locale: lang, catalogs: pick(lang), fallback: pick(DEFAULT_LOCALE) }
}

/** Every namespace of a language, for server use (cheap: references, no copies). */
function fullDictionary(locale: string): Dictionary {
  const lang = hasCatalogs(locale) ? locale : DEFAULT_LOCALE
  return lang === DEFAULT_LOCALE
    ? { locale: lang, catalogs: CATALOGS[lang] ?? {} }
    : { locale: lang, catalogs: CATALOGS[lang] ?? {}, fallback: CATALOGS[DEFAULT_LOCALE] ?? {} }
}

/** `t('da', 'cart', 'bag.empty')`, `t(locale, 'catalog', 'results', { count: 3 })`. */
export function t(locale: string, ns: string, key: string, vars?: TVars): string {
  return translate(fullDictionary(locale), ns, key, vars)
}

/** A translator bound to a locale and default namespace, for a page: `const tt = tFor(locale, 'home')`. */
export function tFor(locale: string, ns: string): TFunction {
  return makeT(fullDictionary(locale), ns)
}

/** Structured value of a key (arrays / objects kept as data in the catalogs). */
export function tValue<T = unknown>(locale: string, ns: string, key: string): T | undefined {
  return translateValue<T>(fullDictionary(locale), ns, key)
}
