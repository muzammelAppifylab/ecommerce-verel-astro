/* Rich text (product and collection descriptions) is stored as HTML from the admin editor. Descriptions saved
   earlier are plain text or Markdown and still render. Never injected as HTML: <RichText> rebuilds an allowlist
   of elements and styles as React elements. Keep worker/lib/rich-text.ts in step. */
import { Lexer, type Token, type Tokens } from 'marked'

// A Lexer instance keeps its tokens between calls, so lex with the static helper (a fresh lexer each time).
const OPTIONS = { gfm: true, breaks: true }

export function richTokens(md: string): Token[] {
  return md.trim() ? Lexer.lex(md, OPTIONS) : []
}

/** Translatable fields stored as rich text; everything else is plain. */
const RICH_FIELDS = new Set(['product.description', 'collection.description'])
export const isRichField = (entity: string, field: string) => RICH_FIELDS.has(`${entity}.${field}`)

/** Only these links survive; anything else (javascript:, data:) renders as its text. */
export function safeHref(href: string): string | null {
  const h = href.trim()
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h
  if (h.startsWith('/') && !h.startsWith('//')) return h
  if (h.startsWith('#')) return h
  return null
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

/** marked keeps some token text entity-escaped; React escapes on its own, so decode first. */
export const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])

/** Visible text of a leaf token (backslash escapes render as the escaped character). */
export const leafText = (t: Token) => (t.type === 'escape' ? t.raw.slice(1) : decode('text' in t ? (t as { text: string }).text : ''))

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'list', 'hr', 'space', 'br', 'code', 'table'])

/** Inline runs join tight ("**soft** wool" → "soft wool"); blocks are separated by a space. */
function plain(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  return tokens
    .map((t) => {
      const text =
        t.type === 'list'
          ? (t as Tokens.List).items.map((i) => plain(i.tokens)).join(' ')
          : 'tokens' in t && t.tokens
            ? plain(t.tokens)
            : t.type === 'hr' || t.type === 'space' || t.type === 'br'
              ? ''
              : leafText(t)
      return BLOCKS.has(t.type) ? ` ${text} ` : text
    })
    .join('')
}

/** Editor output starts with a block element; anything else is the older plain text / Markdown. */
export const isRichHtml = (s: string) => /^\s*<(p|h[1-6]|ul|ol|blockquote|hr|div)[\s>/]/i.test(s)

const BLOCK_TAGS = /<\/?(p|h[1-6]|ul|ol|li|blockquote|div|br|hr)\b[^>]*>/gi

/** Words of stored HTML: block boundaries become spaces, inline tags vanish, entities decode. */
function htmlToPlain(html: string): string {
  return html
    .replace(BLOCK_TAGS, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
}

/** Rich text → one line of plain text, for meta descriptions, cards and other one-line previews. */
export function toPlainText(text: string | null | undefined): string {
  if (!text) return ''
  const words = isRichHtml(text) ? htmlToPlain(text) : plain(richTokens(text))
  return words.replace(/\s+/g, ' ').trim()
}

/* ---------- Editor palette (the renderer accepts any hex, so retiring a swatch never breaks old text) ---------- */

export const TEXT_COLORS = [
  { name: 'Obsidian', value: '#1A1A1A' },
  { name: 'Graphite', value: '#3D3D3D' },
  { name: 'Stone', value: '#6E6E6E' },
  { name: 'Moss', value: '#3F5B45' },
  { name: 'Rust', value: '#8A3A2E' },
  { name: 'Ochre', value: '#7A6A4F' },
] as const

export const HIGHLIGHTS = [
  { name: 'Chalk', value: '#ECECEC' },
  { name: 'Pebble', value: '#D9D9D9' },
  { name: 'Moss', value: '#DFE6E0' },
  { name: 'Rust', value: '#F2E2DE' },
  { name: 'Ochre', value: '#EFE9DC' },
] as const
