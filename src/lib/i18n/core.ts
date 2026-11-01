/* The storefront's translator (PLAN.md D7): a small stand-in for the i18next features VAREL's catalogs use,
   with no dependency and no global state, so the same code runs on the server and in islands.

   Catalog format (src/locales/<locale>/<ns>.json, copied from VAREL as-is):
   - nested objects, addressed with dotted keys: t('bag.empty');
   - `{{name}}` interpolation from vars (unknown placeholders stay visible);
   - plurals: when vars.count is a number, `key_<CLDR form>` (Intl.PluralRules of the locale) then `key_other`;
   - a missing key falls back to the English catalog, then vars.defaultValue, then the key itself;
   - `ns:key` reads another namespace of the same dictionary set.
   Client-safe: catalogs are passed in (islands receive theirs as a prop, see ./server.ts `dictionary`). */
import { INTL_LOCALE } from './locales'

export type Catalog = { [key: string]: unknown }

/** What an island receives: the locale, and per namespace the locale's catalog with the English one as fallback. */
export interface Dictionary {
  locale: string
  /** namespace → catalog in `locale` */
  catalogs: Record<string, Catalog>
  /** namespace → English catalog (only keys the locale lacks need it; omitted for English) */
  fallback?: Record<string, Catalog>
}

export type TVars = Record<string, unknown> & { count?: number; defaultValue?: string }
export type TFunction = (key: string, vars?: TVars) => string

const pluralRules = new Map<string, Intl.PluralRules>()

/** CLDR plural category of `count` in `locale` ("one", "other", "many" …). */
export function pluralForm(locale: string, count: number): Intl.LDMLPluralRule {
  let r = pluralRules.get(locale)
  if (!r) {
    try {
      r = new Intl.PluralRules(INTL_LOCALE[locale] ?? locale)
    } catch {
      r = new Intl.PluralRules('en')
    }
    pluralRules.set(locale, r)
  }
  return r.select(count)
}

/** Value at a dotted path ("bag.empty"), or undefined. A flat key containing dots wins over the nested path. */
export function lookupPath(cat: Catalog | undefined, key: string): unknown {
  if (!cat) return undefined
  if (Object.hasOwn(cat, key)) return cat[key]
  let cur: unknown = cat
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || !Object.hasOwn(cur, part)) return undefined
    cur = (cur as Catalog)[part]
  }
  return cur
}

/** The string for `key` in one catalog, honouring plurals. */
function lookupString(cat: Catalog | undefined, key: string, locale: string, vars: TVars | undefined): string | undefined {
  if (!cat) return undefined
  if (typeof vars?.count === 'number') {
    const form = pluralForm(locale, vars.count)
    const v = lookupPath(cat, `${key}_${form}`) ?? lookupPath(cat, `${key}_other`)
    if (typeof v === 'string') return v
  }
  const v = lookupPath(cat, key)
  return typeof v === 'string' ? v : undefined
}

/** Fill `{{name}}` placeholders. Numbers are written as they are; missing ones stay visible. */
export function interpolate(s: string, vars: TVars | undefined): string {
  if (!vars) return s
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => {
    const v = vars[name]
    return v == null ? whole : String(v)
  })
}

/** Split "ns:key" → ["ns", "key"] (only when the prefix is a known namespace). */
function splitNs(key: string, known: Record<string, Catalog>, ns: string): [string, string] {
  const i = key.indexOf(':')
  if (i > 0) {
    const maybe = key.slice(0, i)
    if (Object.hasOwn(known, maybe)) return [maybe, key.slice(i + 1)]
  }
  return [ns, key]
}

/** Translate one key against a dictionary. */
export function translate(dict: Dictionary, ns: string, key: string, vars?: TVars): string {
  const [n, k] = splitNs(key, { ...dict.fallback, ...dict.catalogs }, ns)
  const s =
    lookupString(dict.catalogs[n], k, dict.locale, vars) ??
    lookupString(dict.fallback?.[n], k, 'en', vars) ??
    (typeof vars?.defaultValue === 'string' ? vars.defaultValue : undefined) ??
    key
  return interpolate(s, vars)
}

/** Raw (possibly structured) value of a key: arrays and objects for lists the catalogs keep as data. */
export function translateValue<T = unknown>(dict: Dictionary, ns: string, key: string): T | undefined {
  const [n, k] = splitNs(key, { ...dict.fallback, ...dict.catalogs }, ns)
  return (lookupPath(dict.catalogs[n], k) ?? lookupPath(dict.fallback?.[n], k)) as T | undefined
}

/** A `t(key, vars)` bound to a dictionary and a default namespace. */
export function makeT(dict: Dictionary, ns: string): TFunction {
  return (key, vars) => translate(dict, ns, key, vars)
}

/** Split "Read our <privacy>policy</privacy> first" into text and tagged parts (for <Trans>-style markup). */
export type RichPart = string | { tag: string; text: string }
export function richParts(s: string): RichPart[] {
  const out: RichPart[] = []
  const re = /<(\w+)>(.*?)<\/\1>/gs
  let at = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push(s.slice(at, m.index))
    out.push({ tag: m[1]!, text: m[2]! })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push(s.slice(at))
  return out
}

/** Intl tag for a storefront language. */
export const intlLocale = (locale: string) => INTL_LOCALE[locale] ?? locale
