/* Email template language (docs/EMAIL.md "Template syntax").

   Variables     {{firstName}}                         escaped in HTML, raw in plain text
   Sections      {{#items}}…{{/items}}                 repeats per row for arrays; renders once for any other truthy value
   Inverted      {{^trackingUrl}}…{{/trackingUrl}}     renders when the value is empty, false or missing
   Markup (one per line, after substitution):
     # Heading                 a display heading
     ---                       a hairline rule
     [Label](url)              alone on a line: a button; inline: a link
     a | b | c                 a table row (consecutive rows form one table; the last cell is right-aligned)
     > note                    a small muted note
     **bold**                  inline emphasis
   Blank lines separate paragraphs. A section tag alone on its line takes the whole line with it.

   Values never become markup: substitution leaves placeholders that the renderers resolve, so a customer's
   "|" or "[" stays literal text and every value is HTML-escaped. */

export type TemplateValue = string | number | boolean | null | undefined | TemplateRow[]
export type TemplateRow = Record<string, string | number | null>
export type TemplateVars = Record<string, TemplateValue>

// Placeholder for the n-th substituted value: \u0001<n>\u0002
const OPEN = '\u0001'
const CLOSE = '\u0002'
const TOKEN_RE = /\u0001(\d+)\u0002/g

type Node = { t: 'text'; v: string } | { t: 'var'; name: string } | { t: 'section'; name: string; inverted: boolean; children: Node[] }

const TAG_RE = /\{\{\s*([#^/]?)\s*([A-Za-z_][\w.]*)\s*\}\}/g

/** Section tags alone on a line consume the line (standalone rule), so blocks do not leave blank lines behind. */
function stripStandalone(src: string): string {
  return src.replace(/^[ \t]*(\{\{\s*[#^/]\s*[A-Za-z_][\w.]*\s*\}\})[ \t]*(?:\r?\n|$)/gm, '$1')
}

export function parseTemplate(src: string): Node[] {
  const root: Node[] = []
  const stack: { name: string; inverted: boolean; children: Node[]; raw: string }[] = []
  const out = () => (stack.length ? stack[stack.length - 1].children : root)
  let last = 0
  const text = stripStandalone(src.replace(/\r\n?/g, '\n'))
  for (const m of text.matchAll(TAG_RE)) {
    if (m.index > last) out().push({ t: 'text', v: text.slice(last, m.index) })
    last = m.index + m[0].length
    const [raw, kind, name] = m
    if (kind === '#' || kind === '^') {
      stack.push({ name, inverted: kind === '^', children: [], raw })
    } else if (kind === '/') {
      const top = stack[stack.length - 1]
      if (top && top.name === name) {
        stack.pop()
        out().push({ t: 'section', name, inverted: top.inverted, children: top.children })
      } else {
        out().push({ t: 'text', v: raw }) // stray closing tag: keep it visible so the author can fix it
      }
    } else {
      out().push({ t: 'var', name })
    }
  }
  if (last < text.length) out().push({ t: 'text', v: text.slice(last) })
  // Unclosed sections close at the end of the template.
  while (stack.length) {
    const top = stack.pop()!
    out().push({ t: 'section', name: top.name, inverted: top.inverted, children: top.children })
  }
  return root
}

type Scope = Record<string, TemplateValue | string | number | null>

function lookup(scopes: Scope[], name: string): TemplateValue {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(scopes[i], name)) return scopes[i][name] as TemplateValue
  }
  return undefined
}

const truthy = (v: TemplateValue) => (Array.isArray(v) ? v.length > 0 : v !== '' && v != null && v !== false)

export function valueText(v: TemplateValue): string {
  if (v == null || v === false || Array.isArray(v)) return ''
  if (v === true) return 'yes'
  return String(v)
}

/** Expand variables and sections. Values become placeholders, collected in `values`. */
export function expand(src: string, vars: TemplateVars): { text: string; values: string[] } {
  const values: string[] = []
  const walk = (nodes: Node[], scopes: Scope[]): string => {
    let s = ''
    for (const n of nodes) {
      if (n.t === 'text') s += n.v
      else if (n.t === 'var') {
        values.push(valueText(lookup(scopes, n.name)))
        s += `${OPEN}${values.length - 1}${CLOSE}`
      } else {
        const v = lookup(scopes, n.name)
        if (n.inverted) {
          if (!truthy(v)) s += walk(n.children, scopes)
        } else if (Array.isArray(v)) {
          for (const row of v) s += walk(n.children, [...scopes, row])
        } else if (truthy(v)) {
          s += walk(n.children, scopes)
        }
      }
    }
    return s
  }
  return { text: walk(parseTemplate(src), [vars as Scope]), values }
}

/** Plain substitution (subjects): no markup, values raw. Newlines collapse to spaces. */
export function substitute(src: string, vars: TemplateVars): string {
  const { text, values } = expand(src, vars)
  return resolve(text, values).replace(/\s*\n\s*/g, ' ').trim()
}

/** Replace placeholders with their raw values. */
export const resolve = (s: string, values: string[]) => s.replace(TOKEN_RE, (_, i) => values[Number(i)] ?? '')

/** True when the string holds placeholders and every one of them is empty. */
export const onlyEmptyValues = (s: string, values: string[]) => {
  const ids = [...s.matchAll(TOKEN_RE)].map((m) => Number(m[1]))
  return ids.length > 0 && ids.every((i) => !values[i]) && s.replace(TOKEN_RE, '').replace(/[*\s]/g, '') === ''
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'rule' }
  | { kind: 'button'; label: string; url: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'note'; lines: string[] }
  | { kind: 'paragraph'; lines: string[] }

const BUTTON_RE = /^\[([^\]]+)\]\(([^)\s]+)\)$/

/** Split expanded text (with placeholders) into layout blocks. */
export function toBlocks(text: string, values: string[]): Block[] {
  const blocks: Block[] = []
  const push = (b: Block) => {
    const prev = blocks[blocks.length - 1]
    if (b.kind === 'paragraph' && prev?.kind === 'paragraph' && !prevBreak) prev.lines.push(...b.lines)
    else if (b.kind === 'note' && prev?.kind === 'note' && !prevBreak) prev.lines.push(...b.lines)
    else if (b.kind === 'table' && prev?.kind === 'table' && !prevBreak) prev.rows.push(...b.rows)
    else blocks.push(b)
    prevBreak = false
  }
  let prevBreak = true
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      prevBreak = true
      continue
    }
    if (line === '---') {
      push({ kind: 'rule' })
      prevBreak = true
      continue
    }
    if (line.startsWith('# ')) {
      push({ kind: 'heading', text: line.slice(2).trim() })
      prevBreak = true
      continue
    }
    const btn = BUTTON_RE.exec(line)
    if (btn) {
      // A button whose link resolved to nothing is dropped.
      if (resolve(btn[2], values).trim()) push({ kind: 'button', label: btn[1], url: btn[2] })
      prevBreak = true
      continue
    }
    if (line.startsWith('> ') || line === '>') {
      push({ kind: 'note', lines: [line.slice(1).trim()] })
      continue
    }
    if (line.includes(' | ')) {
      const cells = line.split(' | ').map((c) => c.trim())
      // Rows whose value (last cell) is empty are left out, e.g. "Discount | {{discount}}" with no discount.
      if (onlyEmptyValues(cells[cells.length - 1], values)) continue
      push({ kind: 'table', rows: [cells] })
      continue
    }
    push({ kind: 'paragraph', lines: [line] })
  }
  return blocks
}

// ─── Inline ─────────────────────────────────────────────────────────────────

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Only http(s) and mailto links survive; anything else becomes "#". */
export const safeUrl = (u: string) => (/^(https?:\/\/|mailto:)/i.test(u.trim()) ? u.trim() : '#')

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

/** Inline markup → HTML. Literal text and values are escaped; URL-looking values become links. */
export function inlineHtml(s: string, values: string[], linkStyle: string): string {
  const parts: string[] = []
  let last = 0
  const lit = (t: string) => {
    // literal template text: escape, then **bold**
    const marked = t.replace(/\*\*(.+?)\*\*/g, '\u0003$1\u0004') // bold markers come from the template, never from values
    let h = ''
    let i = 0
    for (const m of marked.matchAll(TOKEN_RE)) {
      h += escapeHtml(marked.slice(i, m.index))
      const v = values[Number(m[1])] ?? ''
      h += /^https?:\/\/\S+$/.test(v)
        ? `<a href="${escapeHtml(v)}" style="${linkStyle}">${escapeHtml(v)}</a>`
        : escapeHtml(v).replace(/\n/g, '<br>')
      i = m.index + m[0].length
    }
    h += escapeHtml(marked.slice(i))
    return h.replace(/\u0003/g, '<strong style="font-weight:700">').replace(/\u0004/g, '</strong>')
  }
  for (const m of s.matchAll(LINK_RE)) {
    parts.push(lit(s.slice(last, m.index)))
    const href = safeUrl(resolve(m[2], values))
    parts.push(`<a href="${escapeHtml(href)}" style="${linkStyle}">${lit(m[1])}</a>`)
    last = m.index + m[0].length
  }
  parts.push(lit(s.slice(last)))
  return parts.join('')
}

/** Inline markup → plain text. Links read "label (url)". */
export function inlineText(s: string, values: string[]): string {
  return resolve(
    s.replace(LINK_RE, (_, label: string, url: string) => (label === url ? url : `${label} (${url})`)).replace(/\*\*(.+?)\*\*/g, '$1'),
    values,
  )
}

/** Variable names a template uses (for the editor's "unknown variable" hint). */
export function variablesIn(src: string): string[] {
  const names = new Set<string>()
  for (const m of src.matchAll(TAG_RE)) names.add(m[2])
  return [...names]
}
