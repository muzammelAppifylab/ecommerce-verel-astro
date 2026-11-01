/* Value → text units → provider → value (docs/I18N.md "Content").
   - Structured fields (PostBlock[], menu items, homeHero, returnReasons, UI catalogs) are walked and only their
     text leaves are translated; URLs, image sources, credits, ids and block types are kept as they are.
   - Each leaf is split into units (paragraphs or lines; long text is chunked at sentence boundaries).
   - Placeholders ({{firstName}}, URLs, e-mail addresses, **, email markup like "# ", "> ", " | ", "[label](url)")
     are masked as <x0/> markers. If the provider drops or garbles a marker, the text runs between the
     placeholders are translated one by one instead, so placeholders are never lost.
   Pure module (no database): unit-tested in tests/i18n.test.ts. */

export type TranslateMode = 'text' | 'email' | 'catalog'

/** Translates a batch of plain strings (already de-duplicated by the caller or not; order is kept). */
export type BatchTranslator = (texts: string[]) => Promise<string[]>

/** Rich text fields hold editor HTML: their tags must reach the translator as placeholders, not as words. */
const HTML_FIELDS = new Set(['product.description', 'collection.description'])

/** How a field's text is segmented and protected ('catalog' masks HTML tags as <x0/> markers).
    (VAREL kept this in translate.ts; it lives here so the pure module owns it and WP-25 imports it.) */
export const modeFor = (entity: string, field?: string): TranslateMode =>
  entity === 'email_template' ? 'email' : entity === 'ui' || HTML_FIELDS.has(`${entity}.${field}`) ? 'catalog' : 'text'

/** Longest unit sent to a provider in one piece (m2m100 is happiest well under 1,000 characters). */
export const MAX_UNIT = 900

// ─── Leaves ─────────────────────────────────────────────────────────────────

/** Keys whose string values are never translated (structure, links, media, attribution). */
const SKIP_KEYS = new Set(['url', 'href', 'src', 'creditHref', 'credit', 'cite', 'type', 'id', 'slug', 'key', 'swatch', 'sku', 'icon'])

const LETTER = /\p{L}/u
const URLISH = /^(https?:\/\/|\/|mailto:|tel:|#|www\.)\S*$/i
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Codes such as STUDIO10 or FREESHIP: one upper-case token, kept as is. */
const CODEISH = /^[\p{Lu}\d_-]{3,}$/u

/** Whether a string leaf carries words worth translating. */
export const isTranslatableText = (s: string): boolean => {
  const t = s.trim()
  return LETTER.test(t) && !URLISH.test(t) && !EMAILISH.test(t) && !CODEISH.test(t)
}

/** Walk a value and collect its translatable string leaves in a stable order. */
export function collectLeaves(value: unknown, mode: TranslateMode = 'text'): string[] {
  const out: string[] = []
  walk(value, mode, (s) => {
    out.push(s)
    return s
  })
  return out
}

/** Rebuild `value` with its leaves replaced, in the order collectLeaves returned them. */
export function replaceLeaves<T>(value: T, mode: TranslateMode, leaves: string[]): T {
  let i = 0
  return walk(value, mode, (s) => leaves[i++] ?? s) as T
}

function walk(v: unknown, mode: TranslateMode, leaf: (s: string) => string, key?: string): unknown {
  if (typeof v === 'string') {
    if (mode !== 'catalog' && key && SKIP_KEYS.has(key)) return v
    return isTranslatableText(v) ? leaf(v) : v
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, mode, leaf, key))
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x, mode, leaf, k)
    return o
  }
  return v
}

// ─── Units and placeholders ─────────────────────────────────────────────────

const COMMON_TOKENS = [
  String.raw`\{\{[^{}]*\}\}`, // {{firstName}}, {{#items}}, {{- name}}
  String.raw`https?:\/\/[^\s<>()\]]+`,
  String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`,
  String.raw`\*\*`,
]
const EMAIL_TOKENS = [
  String.raw`^#{1,6}[ \t]+`, // heading
  String.raw`^>[ \t]?`, // note
  String.raw`^-{3,}$`, // rule
  String.raw`[ \t]*\|[ \t]*`, // table cells
  String.raw`\]\([^)]*\)`, // link target
  String.raw`\[`,
  '×',
]
const CATALOG_TOKENS = [String.raw`\$t\([^)]*\)`, String.raw`<\/?\d+\s*\/?>`, String.raw`<\/?[a-zA-Z][^<>]*>`]

const tokenRe = (mode: TranslateMode) =>
  new RegExp([...(mode === 'email' ? EMAIL_TOKENS : mode === 'catalog' ? CATALOG_TOKENS : []), ...COMMON_TOKENS].join('|'), 'g')

const MARKER_RE = /<\s*x\s*(\d+)\s*\/?\s*>/g
const marker = (i: number) => `<x${i}/>`

/** A piece of text to translate, with its placeholders masked as <x0/>, <x1/>… */
export interface Unit {
  masked: string
  tokens: string[]
}
type Segment = string | Unit

export function mask(core: string, mode: TranslateMode): Unit {
  const tokens: string[] = []
  const masked = core.replace(tokenRe(mode), (m) => {
    tokens.push(m)
    return marker(tokens.length - 1)
  })
  return { masked, tokens }
}

/** Put the placeholders back. Null when the translation lost, duplicated or invented a marker. */
export function unmask(translated: string, tokens: string[]): string | null {
  const seen = new Set<number>()
  let ok = true
  const out = translated.replace(MARKER_RE, (_, n: string) => {
    const i = Number(n)
    if (i >= tokens.length || seen.has(i)) ok = false
    seen.add(i)
    return tokens[i] ?? ''
  })
  return ok && seen.size === tokens.length ? out : null
}

/** Split long text into chunks of at most `max` characters at sentence (then word) boundaries. */
export function chunkText(text: string, max = MAX_UNIT): string[] {
  if (text.length <= max) return [text]
  const sentences = text.split(/(?<=[.!?…;:])\s+/)
  const pieces: string[] = []
  for (const s of sentences) {
    if (s.length <= max) pieces.push(s)
    else {
      let cur = ''
      for (const w of s.split(/\s+/)) {
        if (cur && cur.length + 1 + w.length > max) {
          pieces.push(cur)
          cur = w
        } else cur = cur ? `${cur} ${w}` : w
      }
      if (cur) pieces.push(cur)
    }
  }
  const chunks: string[] = []
  let cur = ''
  for (const p of pieces) {
    if (cur && cur.length + 1 + p.length > max) {
      chunks.push(cur)
      cur = p
    } else cur = cur ? `${cur} ${p}` : p
  }
  if (cur) chunks.push(cur)
  return chunks
}

/** A leaf as literal text and units: lines (email) or paragraphs, long ones chunked, whitespace kept literal. */
export function segment(leaf: string, mode: TranslateMode): Segment[] {
  const out: Segment[] = []
  const parts = leaf.split(mode === 'email' ? /(\n)/ : /(\n+)/)
  for (const part of parts) {
    if (!part) continue
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(part)!
    const [, lead, core, trail] = m
    if (lead) out.push(lead)
    if (core) {
      const chunks = chunkText(core)
      chunks.forEach((chunk, i) => {
        if (i) out.push(' ')
        const words = mask(chunk, mode).masked.replace(MARKER_RE, '')
        if (!LETTER.test(words)) return void out.push(chunk)
        const { pre, unit, post } = peel(mask(chunk, mode))
        if (pre) out.push(pre)
        out.push(unit)
        if (post) out.push(post)
      })
    }
    if (trail) out.push(trail)
  }
  return out
}

/** Plain variables ({{count}}) stay in the sentence so a translation can move them; markup and section tags do not. */
const peelable = (token: string) => !/^\{\{\s*-?\s*[\w.]+\s*\}\}$/.test(token)

/** Move placeholders at the very start or end of a unit out of it ("# Heading" sends only "Heading"). */
export function peel(u: Unit): { pre: string; unit: Unit; post: string } {
  let masked = u.masked
  const tokens = [...u.tokens]
  let pre = ''
  let post = ''
  for (let m = /^(\s*)<x0\/>(\s*)/.exec(masked); m && tokens.length && peelable(tokens[0]); m = /^(\s*)<x0\/>(\s*)/.exec(masked)) {
    pre += m[1] + tokens.shift() + m[2]
    masked = masked.slice(m[0].length).replace(/<x(\d+)\/>/g, (_, n: string) => marker(Number(n) - 1))
  }
  while (tokens.length && peelable(tokens[tokens.length - 1])) {
    const m = new RegExp(`(\\s*)<x${tokens.length - 1}\\/>(\\s*)$`).exec(masked)
    if (!m) break
    post = m[1] + tokens.pop() + m[2] + post
    masked = masked.slice(0, m.index)
  }
  return { pre, unit: { masked, tokens }, post }
}

/** Text runs of a masked unit, for the fallback path: [literal, run, literal, run…]. */
function runsOf(u: Unit): Segment[] {
  const out: Segment[] = []
  let last = 0
  const pieces: string[] = []
  u.masked.replace(MARKER_RE, (m, n: string, at: number) => {
    pieces.push(u.masked.slice(last, at))
    pieces.push(u.tokens[Number(n)] ?? '')
    last = at + m.length
    return m
  })
  pieces.push(u.masked.slice(last))
  pieces.forEach((p, i) => {
    if (i % 2 === 1) return void out.push(p) // a placeholder
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p)!
    if (m[1]) out.push(m[1])
    if (m[2]) out.push(LETTER.test(m[2]) ? { masked: m[2], tokens: [] } : m[2])
    if (m[3]) out.push(m[3])
  })
  return out
}

// ─── Translate values ───────────────────────────────────────────────────────

/** De-duplicate, translate, map back. */
async function translateUnique(texts: string[], translator: BatchTranslator): Promise<Map<string, string>> {
  const unique = [...new Set(texts)]
  const map = new Map<string, string>()
  if (!unique.length) return map
  const out = await translator(unique)
  unique.forEach((t, i) => {
    const r = out[i]
    if (typeof r !== 'string' || (!r.trim() && t.trim())) throw new Error('The provider returned an empty translation')
    map.set(t, r)
  })
  return map
}

/** Translate many values (strings or structured) in one go, sharing provider batches. Same shapes come back. */
export async function translateValues(items: { value: unknown; mode: TranslateMode }[], translator: BatchTranslator): Promise<unknown[]> {
  const plans = items.map(({ value, mode }) => {
    const leaves = typeof value === 'string' ? (isTranslatableText(value) || mode === 'email' ? [value] : []) : collectLeaves(value, mode)
    return { value, mode, segs: leaves.map((l) => segment(l, mode)) }
  })
  const units = plans.flatMap((p) => p.segs.flat().filter((s): s is Unit => typeof s !== 'string'))
  const first = await translateUnique(units.map((u) => u.masked), translator)

  // Phase 2: units whose markers did not survive are translated run by run.
  const restored = new Map<Unit, string>()
  const failed: { unit: Unit; runs: Segment[] }[] = []
  for (const u of units) {
    const r = u.tokens.length ? unmask(first.get(u.masked)!, u.tokens) : first.get(u.masked)!
    if (r != null) restored.set(u, r)
    else failed.push({ unit: u, runs: runsOf(u) })
  }
  if (failed.length) {
    const runTexts = failed.flatMap((f) => f.runs.filter((s): s is Unit => typeof s !== 'string').map((s) => s.masked))
    const second = await translateUnique(runTexts, translator)
    for (const f of failed) {
      restored.set(f.unit, f.runs.map((s) => (typeof s === 'string' ? s : second.get(s.masked)!)).join(''))
    }
  }

  return plans.map((p) => {
    const leaves = p.segs.map((segs) => segs.map((s) => (typeof s === 'string' ? s : restored.get(s)!)).join(''))
    if (typeof p.value === 'string') return leaves[0] ?? p.value
    return replaceLeaves(p.value, p.mode, leaves)
  })
}

/** One value. */
export async function translateValue<T>(value: T, mode: TranslateMode, translator: BatchTranslator): Promise<T> {
  const [out] = await translateValues([{ value, mode }], translator)
  return out as T
}
