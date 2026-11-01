import {Fragment, type ReactNode, useEffect, useMemo, useRef} from 'react';
import type {Token, Tokens} from 'marked';

import {cn} from '@/lib/utils';

import {
  COLOR_CLASS,
  HIGHLIGHT_CLASS,
  type HtmlNode,
  isRichHtml,
  leafText,
  normalizeColor,
  parseHtml,
  parseStyle,
  richTokens,
  safeHref,
} from './rich-html';

type Level = 2 | 3 | 4 | 5 | 6;

export interface RichTextProps {
  /** HTML from the admin rich text editor (older plain text and Markdown work too) */
  text: string | null | undefined;
  /** Tag for the top heading the author used (H1 in the editor); lower ones step down from it. Pick what fits the page outline. */
  headingLevel?: Level;
  size?: 'md' | 'sm';
  className?: string;
  id?: string;
}

/**
 * Renders stored rich text as React elements, never by injecting HTML: only allowlisted elements, alignment and
 * colour survive, and links are limited to http(s), mailto, tel and on-site paths. Styles live on `.rich-text`
 * in storefront.css. Renders the same on the server and in the browser.
 *
 * The CSP forbids style="": alignment becomes a class, palette colours become classes (`rt-c-*`, `rt-hl-*`), and
 * any other colour is carried in a data attribute and painted after hydration through element.style.
 */
export function RichText({text, headingLevel = 2, size = 'md', className, id}: RichTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const body = useMemo(() => {
    const src = text ?? '';
    if (!src.trim()) return null;
    if (isRichHtml(src)) return nodes(parseHtml(src), headingLevel);
    const tokens = richTokens(src);
    return tokens.length ? blocks(tokens, headingLevel) : null;
  }, [text, headingLevel]);
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[data-rt-color],[data-rt-bg]').forEach(el => {
      if (el.dataset.rtColor) el.style.color = el.dataset.rtColor;
      if (el.dataset.rtBg) el.style.backgroundColor = el.dataset.rtBg;
    });
  }, [body]);
  if (!body) return null;
  return (
    <div ref={ref} id={id} data-size={size} className={cn('rich-text', className)}>
      {body}
    </div>
  );
}

/* ---------- HTML (editor output) ---------- */

const PASS = new Set(['p', 'strong', 'em', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'code']);
const ALIAS: Record<string, string> = {b: 'strong', i: 'em', del: 's', strike: 's'};
const ALIGN: Record<string, string> = {left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify'};

interface Look {
  className?: string;
  'data-rt-color'?: string;
  'data-rt-bg'?: string;
}

/** The only styling kept: alignment on blocks, text colour and highlight on inline runs. */
function lookOf(attrs: Record<string, string>, block: boolean): Look | undefined {
  const st = parseStyle(attrs.style);
  const out: Look = {};
  const classes: string[] = [];
  if (block) {
    const align = ALIGN[(st['text-align'] ?? '').toLowerCase()];
    if (align) classes.push(align);
  } else {
    const color = st.color ? normalizeColor(st.color) : null;
    if (color) {
      if (COLOR_CLASS[color]) classes.push(COLOR_CLASS[color]);
      else out['data-rt-color'] = color;
    }
    const bgRaw = st['background-color'] || attrs['data-color'] || '';
    const bg = bgRaw ? normalizeColor(bgRaw) : null;
    if (bg) {
      if (HIGHLIGHT_CLASS[bg]) classes.push(HIGHLIGHT_CLASS[bg]);
      else out['data-rt-bg'] = bg;
    }
  }
  if (classes.length) out.className = classes.join(' ');
  return Object.keys(out).length ? out : undefined;
}

function nodes(list: HtmlNode[], level: Level): ReactNode {
  return list.map((n, i) => <Fragment key={i}>{node(n, level)}</Fragment>);
}

function node(n: HtmlNode, level: Level): ReactNode {
  if (n.type === 'text') return n.text;
  const tag = ALIAS[n.tag] ?? n.tag;
  const kids = () => nodes(n.children, level);

  const h = /^h([1-6])$/.exec(tag);
  if (h) {
    const depth = Number(h[1]);
    const Tag = `h${Math.min(6, level + depth - 1)}` as 'h2';
    return (
      <Tag data-depth={depth} {...lookOf(n.attrs, true)}>
        {kids()}
      </Tag>
    );
  }
  if (tag === 'br') return <br />;
  if (tag === 'hr') return <hr />;
  if (tag === 'a') {
    const href = safeHref(n.attrs.href ?? '');
    if (!href) return kids();
    const external = /^https?:/i.test(href);
    return (
      <a href={href} {...(external ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>
        {kids()}
      </a>
    );
  }
  if (tag === 'mark' || tag === 'span') {
    const look = lookOf(n.attrs, false);
    if (tag === 'mark') return <mark {...look}>{kids()}</mark>;
    return look ? <span {...look}>{kids()}</span> : kids();
  }
  if (PASS.has(tag)) {
    const Tag = tag as 'p';
    const block = tag === 'p' || tag === 'li' || tag === 'blockquote';
    const start = tag === 'ol' ? Number(n.attrs.start) || undefined : undefined;
    return (
      <Tag {...lookOf(n.attrs, block)} {...(start && start !== 1 ? {start} : {})}>
        {kids()}
      </Tag>
    );
  }
  // Anything else (div, img, iframe, table…): keep the words, drop the element. (script/style never parse.)
  return kids();
}

/* ---------- Markdown (descriptions saved before the HTML editor) ---------- */

function blocks(tokens: Token[], level: Level): ReactNode {
  return tokens.map((t, i) => <Fragment key={i}>{block(t, level)}</Fragment>);
}

function block(t: Token, level: Level): ReactNode {
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      const Tag = `h${Math.min(6, level + (h.depth > 2 ? 1 : 0))}` as 'h2';
      return <Tag data-depth={h.depth > 2 ? 3 : 2}>{inline(h.tokens)}</Tag>;
    }
    case 'paragraph':
      return <p>{inline((t as Tokens.Paragraph).tokens)}</p>;
    case 'list': {
      const l = t as Tokens.List;
      const items = l.items.map((item, i) => <li key={i}>{listItem(item, level)}</li>);
      return l.ordered ? (
        <ol start={typeof l.start === 'number' && l.start !== 1 ? l.start : undefined}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }
    case 'blockquote':
      return <blockquote>{blocks((t as Tokens.Blockquote).tokens, level)}</blockquote>;
    case 'hr':
      return <hr />;
    case 'space':
      return null;
    case 'text': {
      const x = t as Tokens.Text;
      return <p>{x.tokens ? inline(x.tokens) : leafText(x)}</p>;
    }
    default:
      // Code, tables, raw HTML: the editor never writes them; show the source as text rather than drop it.
      return t.raw.trim() ? <p>{t.raw.trim()}</p> : null;
  }
}

/** Tight list items hold bare text tokens; loose ones hold paragraphs. */
function listItem(item: Tokens.ListItem, level: Level): ReactNode {
  return item.tokens.map((t, i) => (
    <Fragment key={i}>{t.type === 'text' ? inline((t as Tokens.Text).tokens ?? [t]) : block(t, level)}</Fragment>
  ));
}

function inline(tokens: Token[] | undefined): ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'strong':
        return <strong key={i}>{inline((t as Tokens.Strong).tokens)}</strong>;
      case 'em':
        return <em key={i}>{inline((t as Tokens.Em).tokens)}</em>;
      case 'del':
        return <s key={i}>{inline((t as Tokens.Del).tokens)}</s>;
      case 'br':
        return <br key={i} />;
      case 'codespan':
        return <code key={i}>{leafText(t)}</code>;
      case 'link': {
        const l = t as Tokens.Link;
        const href = safeHref(l.href);
        if (!href) return <Fragment key={i}>{inline(l.tokens)}</Fragment>;
        const external = /^https?:/i.test(href);
        return (
          <a key={i} href={href} {...(external ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>
            {inline(l.tokens)}
          </a>
        );
      }
      case 'text': {
        const x = t as Tokens.Text;
        return <Fragment key={i}>{x.tokens ? inline(x.tokens) : leafText(x)}</Fragment>;
      }
      default:
        // escape, raw html, images: their text only
        return <Fragment key={i}>{t.type === 'html' ? t.raw : leafText(t)}</Fragment>;
    }
  });
}
