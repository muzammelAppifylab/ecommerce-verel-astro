/* Server-side UI text (errors, stock labels, badges, dates…) in the request locale (docs/I18N.md).
   Catalogs: worker/locales/<locale>.ts (English is the source; every catalog has the same keys).
   - serverT(locale, key, vars?, fallback?): catalog text for the locale → the English fallback → the English catalog → key.
     `{name}` placeholders are filled from vars. Plurals: when vars.count is a number, `key_<CLDR form>` then `key_other`.
     For English the fallback (when given) wins, so English output stays byte-identical to the strings callers pass.
   - localizeMessage(locale, english): translate an already-built English message (HttpError messages and field errors
     thrown deep in the code) by matching it against the English catalog — exact text first, then `{placeholder}`
     templates (most specific first). Captured values that are themselves catalog text (e.g. "your first name") are
     translated too. Unknown text is returned unchanged.
   - formatDate / formatMonthYear: "18 August 2026" / "March 2024" with Intl in the locale. */
import { en, type MessageKey, type Messages } from './catalogs/en'
import { da } from './catalogs/da'
import { de } from './catalogs/de'
import { fr } from './catalogs/fr'
import { es } from './catalogs/es'
import { sv } from './catalogs/sv'

export type MessageVars = Record<string, string | number>
export type { MessageKey }

/** Shipped server catalogs. Languages added later fall back to English server text. */
export const SERVER_CATALOGS: Record<string, Messages> = { en, da, de, fr, es, sv }

/** Intl locale per storefront language (dates; region chosen for the store's audience). */
export const INTL_LOCALE: Record<string, string> = {
  en: 'en-GB',
  da: 'da-DK',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  sv: 'sv-SE',
}

const fill = (s: string, vars: MessageVars) => s.replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n] ?? `{${n}}`))

const pluralRules = new Map<string, Intl.PluralRules>()
function pluralForm(locale: string, count: number): string {
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

function lookup(cat: Messages | undefined, key: string, vars: MessageVars, locale: string): string | undefined {
  if (!cat) return undefined
  const c = cat as Record<string, string>
  if (typeof vars.count === 'number') {
    const v = c[`${key}_${pluralForm(locale, vars.count)}`] ?? c[`${key}_other`]
    if (v != null) return v
  }
  return c[key]
}

export function serverT(locale: string, key: MessageKey | (string & {}), vars: MessageVars = {}, fallback?: string): string {
  const isEn = !locale || locale === 'en'
  const s =
    (isEn ? undefined : lookup(SERVER_CATALOGS[locale], key, vars, locale)) ??
    fallback ??
    lookup(en, key, vars, 'en') ??
    key
  return fill(s, vars)
}

/** A translator bound to one locale (what serializers and the promotions engine take). */
export type Translator = (key: MessageKey | (string & {}), vars?: MessageVars, fallback?: string) => string
export const translatorFor = (locale: string): Translator => (key, vars, fallback) => serverT(locale, key, vars, fallback)

// ─── Reverse lookup: English text → key ─────────────────────────────────────

interface Template {
  key: string
  re: RegExp
  names: string[]
  literal: number
}

/** Only whole-message templates take part in the reverse lookup (not fragments such as "{name} in {options}"). */
const MESSAGE_TEMPLATE = /^(error|field|returns|discount|stock)\./
const NOT_A_MESSAGE = new Set(['discount.summary', 'stock.variantIn'])

let exact: Map<string, string> | null = null
let templates: Template[] = []

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function index() {
  if (exact) return
  exact = new Map()
  const list: Template[] = []
  for (const [k, v] of Object.entries(en)) {
    const key = k.replace(/_(zero|one|two|few|many|other)$/, '')
    if (!/\{\w+\}/.test(v)) {
      if (!exact.has(v)) exact.set(v, key)
      continue
    }
    if (!MESSAGE_TEMPLATE.test(key) || NOT_A_MESSAGE.has(key)) continue
    const names: string[] = []
    const parts = v.split(/(\{\w+\})/)
    let literal = 0
    const src = parts
      .map((p) => {
        const m = /^\{(\w+)\}$/.exec(p)
        if (m) {
          names.push(m[1]!)
          return '(.+?)'
        }
        literal += p.length
        return escRe(p)
      })
      .join('')
    list.push({ key, re: new RegExp(`^${src}$`, 's'), names, literal })
  }
  // Most specific first: more fixed text wins over generic shapes like "Enter {label}".
  templates = list.sort((a, b) => b.literal - a.literal)
}

/** Translate an English message produced by the Worker into `locale` (unchanged when unknown or English). */
export function localizeMessage(locale: string, message: string): string {
  if (!locale || locale === 'en' || !SERVER_CATALOGS[locale] || !message) return message
  index()
  const key = exact!.get(message)
  if (key) return serverT(locale, key, {}, message)
  for (const t of templates) {
    const m = t.re.exec(message)
    if (!m) continue
    const vars: MessageVars = {}
    t.names.forEach((n, i) => {
      const raw = m[i + 1]!
      const inner = exact!.get(raw)
      const asNumber = /^\d+$/.test(raw) && n === 'count' ? Number(raw) : null
      const variant = n === 'item' ? /^(.+) in (.+)$/s.exec(raw) : null // "Forma Overshirt in Camel / M"
      vars[n] =
        asNumber ??
        (inner ? serverT(locale, inner, {}, raw) : variant ? serverT(locale, 'stock.variantIn', { name: variant[1]!, options: variant[2]! }) : raw)
    })
    return serverT(locale, t.key, vars, message)
  }
  return message
}

/** Field errors `{ path: message }` translated with localizeMessage. */
export function localizeFields(locale: string, fields: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fields || !locale || locale === 'en') return fields
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, localizeMessage(locale, v)]))
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const dateFormats = new Map<string, Intl.DateTimeFormat>()
function dateFormat(locale: string, kind: 'date' | 'month'): Intl.DateTimeFormat {
  const id = `${locale}:${kind}`
  let f = dateFormats.get(id)
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      kind === 'date' ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' }
    try {
      f = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? locale, opts)
    } catch {
      f = new Intl.DateTimeFormat('en-GB', opts)
    }
    dateFormats.set(id, f)
  }
  return f
}

/** "18 August 2026" · "18. august 2026" · "18. August 2026" · "18 août 2026" · "18 de agosto de 2026" · "18 augusti 2026" */
export const formatDate = (d: Date, locale = 'en'): string => dateFormat(locale, 'date').format(d)

/** "March 2024" · "marts 2024" … */
export const formatMonthYear = (d: Date, locale = 'en'): string => dateFormat(locale, 'month').format(d)
