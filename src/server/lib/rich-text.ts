/* Product and collection descriptions are HTML from the admin rich text editor (older ones: plain text or
   Markdown); src/lib/rich-text.ts renders them. Meta tags, JSON-LD and the search index need the words only. */
import { Lexer, type Token, type Tokens } from 'marked'

// A Lexer instance keeps its tokens between calls, so lex with the static helper (a fresh lexer each time).
const OPTIONS = { gfm: true, breaks: true }
const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'list', 'hr', 'space', 'br', 'code', 'table'])
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

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
              : t.type === 'escape'
                ? t.raw.slice(1)
                : 'text' in t
                  ? String(t.text).replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
                  : ''
      return BLOCKS.has(t.type) ? ` ${text} ` : text
    })
    .join('')
}

const isRichHtml = (s: string) => /^\s*<(p|h[1-6]|ul|ol|blockquote|hr|div)[\s>/]/i.test(s)
const BLOCK_TAGS = /<\/?(p|h[1-6]|ul|ol|li|blockquote|div|br|hr)\b[^>]*>/gi

function htmlToPlain(html: string): string {
  return html
    .replace(BLOCK_TAGS, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
}

/** Rich text → one line of plain text. Plain text passes through unchanged (apart from whitespace). */
export function toPlainText(text: string | null | undefined): string {
  if (!text?.trim()) return ''
  const words = isRichHtml(text) ? htmlToPlain(text) : plain(Lexer.lex(text, OPTIONS))
  return words.replace(/\s+/g, ' ').trim()
}
