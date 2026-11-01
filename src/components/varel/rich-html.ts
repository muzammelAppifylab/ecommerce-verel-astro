/*
 * Rich text helpers for <RichText>, ported from VAREL `src/lib/rich-text.ts`, plus a small HTML reader.
 *
 * VAREL parsed the editor's HTML with the browser's DOMParser, which does not exist while Astro renders an
 * island on the server (and its output must match the browser's on hydration). `parseHtml` below reads the
 * editor's output (Tiptap: well-formed, a handful of tags) the same way on both sides. It builds a tree only;
 * <RichText> then keeps an allowlist of elements as React elements. Nothing is ever injected as HTML.
 *
 * WAVE 0 NOTE: F4 owns the shared `src/lib/rich-text.ts` (tests/rich-text.test.ts); these are the same
 * functions, kept here so the design system compiles before F4 merges.
 */
import {Lexer, type Token, type Tokens} from 'marked';

const OPTIONS = {gfm: true, breaks: true};

/** Markdown tokens (descriptions saved before the HTML editor). A fresh lexer each call. */
export function richTokens(md: string): Token[] {
  return md.trim() ? Lexer.lex(md, OPTIONS) : [];
}

/** Only these links survive; anything else (javascript:, data:) renders as its text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (h.startsWith('#')) return h;
  return null;
}

const ENTITIES: Record<string, string> = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"};

/** marked keeps some token text entity-escaped; React escapes on its own, so decode first. */
export const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, m => ENTITIES[m]);

/** Visible text of a leaf token (backslash escapes render as the escaped character). */
export const leafText = (t: Token) =>
  t.type === 'escape' ? t.raw.slice(1) : decode('text' in t ? (t as Tokens.Text).text : '');

/** Editor output starts with a block element; anything else is the older plain text / Markdown. */
export const isRichHtml = (s: string) => /^\s*<(p|h[1-6]|ul|ol|blockquote|hr|div)[\s>/]/i.test(s);

/* ---------- A small HTML reader (same result on the server and in the browser) ---------- */

export interface HtmlElement {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
export interface HtmlText {
  type: 'text';
  text: string;
}
export type HtmlNode = HtmlElement | HtmlText;

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'base', 'embed', 'track']);
/* Elements whose content is not markup: skipped whole. */
const RAW = new Set(['script', 'style', 'textarea', 'title']);

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  times: '×',
  euro: '€',
  shy: '­',
};

/** Decode HTML character references (named, decimal and hex). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(ATTR)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/** Parse an HTML fragment into a tree. Unclosed elements close at their parent's end; stray end tags are ignored. */
export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlElement = {type: 'element', tag: '#root', attrs: {}, children: []};
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1];
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (s: string) => {
    if (s) top().children.push({type: 'text', text: decodeEntities(s)});
  };
  while ((m = tagRe.exec(html))) {
    text(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const [, closeTag, openTag, attrSrc, selfClose] = m;
    if (closeTag) {
      const name = closeTag.toLowerCase();
      const at = stack.map(e => e.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    if (!openTag) continue; // comment, doctype, CDATA
    const tag = openTag.toLowerCase();
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      const close = end < 0 ? html.length : html.indexOf('>', end) + 1 || html.length;
      tagRe.lastIndex = close;
      last = close;
      continue;
    }
    const el: HtmlElement = {type: 'element', tag, attrs: parseAttrs(attrSrc ?? ''), children: []};
    top().children.push(el);
    if (!selfClose && !VOID.has(tag)) stack.push(el);
  }
  text(html.slice(last));
  return root.children;
}

/** `color: #8A3A2E; text-align: center` → {color: '#8A3A2E', 'text-align': 'center'} */
export function parseStyle(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

/* ---------- Editor palette (VAREL TEXT_COLORS / HIGHLIGHTS) → classes in storefront.css ---------- */

export const TEXT_COLORS = [
  {name: 'Obsidian', value: '#1A1A1A'},
  {name: 'Graphite', value: '#3D3D3D'},
  {name: 'Stone', value: '#6E6E6E'},
  {name: 'Moss', value: '#3F5B45'},
  {name: 'Rust', value: '#8A3A2E'},
  {name: 'Ochre', value: '#7A6A4F'},
] as const;

export const HIGHLIGHTS = [
  {name: 'Chalk', value: '#ECECEC'},
  {name: 'Pebble', value: '#D9D9D9'},
  {name: 'Moss', value: '#DFE6E0'},
  {name: 'Rust', value: '#F2E2DE'},
  {name: 'Ochre', value: '#EFE9DC'},
] as const;

/** `#abc`, `#aabbcc`, `rgb(…)` → `#aabbcc` (lowercase); null when it is not one of those. */
export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${m[1].split('').map(c => c + c).join('')}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(v);
  if (m) return `#${[m[1], m[2], m[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
  return null;
}

const byHex = (list: ReadonlyArray<{name: string; value: string}>, prefix: string) =>
  Object.fromEntries(list.map(c => [c.value.toLowerCase(), `${prefix}${c.name.toLowerCase()}`])) as Record<string, string>;

/** Palette text colour → class (`rt-c-rust`). */
export const COLOR_CLASS = byHex(TEXT_COLORS, 'rt-c-');
/** Palette highlight → class (`rt-hl-moss`). */
export const HIGHLIGHT_CLASS = byHex(HIGHLIGHTS, 'rt-hl-');
