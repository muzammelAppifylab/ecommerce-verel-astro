/* Branded email rendering (port of VAREL worker/lib/email/render.ts, WP-22). The inline CSS is email HTML,
   never served as a page of this site: the admin preview applies it through the CSSOM (EmailFrame.tsx).
   Template body body → table-based HTML with inline CSS, plus a plain-text alternative.
   No images: the VAREL wordmark is type-set (Lato light, wide tracking), colours are the ink palette, structure is hairlines. */
import {
  escapeHtml,
  expand,
  inlineHtml,
  inlineText,
  resolve,
  safeUrl,
  substitute,
  toBlocks,
  type Block,
  type TemplateVars,
} from './template'

export interface Brand {
  storeName: string
  supportEmail: string
  siteUrl: string
  /** Optional footer lines (legal name, business address) */
  address?: string
  /** The message's language for `<html lang>` (the recipient's locale); default `en`. */
  lang?: string
}

const langOf = (lang: string | undefined) => (lang && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang) ? lang : 'en')

export interface Rendered {
  subject: string
  html: string
  text: string
}

// Ink palette (src/styles/tokens.css)
const INK = { 900: '#1A1A1A', 700: '#3D3D3D', 500: '#6E6E6E', 400: '#8C8C8C', 200: '#D9D9D9', 100: '#E8E8E8', 50: '#F5F5F5', 0: '#FFFFFF' }
const SANS = "Lato,'Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif"
const LINK = `color:${INK[900]};text-decoration:underline;text-underline-offset:3px`

function blockHtml(b: Block, values: string[]): string {
  const inline = (s: string) => inlineHtml(s, values, LINK)
  switch (b.kind) {
    case 'heading':
      return `<tr><td style="padding:0 0 18px;font-family:${SERIF};font-size:30px;line-height:1.15;font-weight:400;color:${INK[900]};letter-spacing:-0.01em">${inline(b.text)}</td></tr>`
    case 'rule':
      return `<tr><td style="padding:6px 0 22px"><div style="height:1px;line-height:1px;font-size:0;background:${INK[200]}">&nbsp;</div></td></tr>`
    case 'button': {
      const href = escapeHtml(safeUrl(resolve(b.url, values)))
      return `<tr><td style="padding:6px 0 26px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK[900]}" style="background:${INK[900]}"><a href="${href}" style="display:inline-block;padding:15px 30px;font-family:${SANS};font-size:12px;line-height:1;font-weight:400;letter-spacing:0.16em;text-transform:uppercase;color:${INK[0]};text-decoration:none">${inlineHtml(b.label, values, `color:${INK[0]};text-decoration:none`)}</a></td></tr></table></td></tr>`
    }
    case 'note':
      return `<tr><td style="padding:0 0 18px;font-family:${SANS};font-size:13px;line-height:1.6;font-weight:300;color:${INK[500]}">${b.lines.map(inline).join('<br>')}</td></tr>`
    case 'paragraph':
      return `<tr><td style="padding:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.62;font-weight:300;color:${INK[900]}">${b.lines.map(inline).join('<br>')}</td></tr>`
    case 'table': {
      // Two-column tables are summaries (label · value); wider ones are line items with hairline rows.
      const summary = b.rows.every((r) => r.length <= 2)
      const rows = b.rows
        .map((cells, ri) => {
          const strong = cells.some((c) => c.startsWith('**'))
          const border = summary
            ? strong
              ? `border-top:1px solid ${INK[900]};`
              : ''
            : `${ri === 0 ? `border-top:1px solid ${INK[200]};` : ''}border-bottom:1px solid ${INK[200]};`
          const pad = summary ? (strong ? '12px 0 4px' : '4px 0') : '14px 0'
          return `<tr>${cells
            .map((c, ci) => {
              const last = ci === cells.length - 1 && cells.length > 1
              const first = ci === 0
              const color = first || last ? INK[900] : INK[500]
              const size = summary ? (strong ? 15 : 14) : first ? 14 : 13
              const align = last ? 'right' : 'left'
              const gap = ci > 0 && !last ? 'padding-left:14px;' : last ? 'padding-left:14px;white-space:nowrap;' : ''
              return `<td align="${align}" style="${border}padding:${pad};${gap}font-family:${SANS};font-size:${size}px;line-height:1.45;font-weight:${first && !summary ? 400 : 300};color:${color};text-align:${align};vertical-align:top">${inlineHtml(c, values, LINK)}</td>`
            })
            .join('')}</tr>`
        })
        .join('')
      return `<tr><td style="padding:0 0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${rows}</table></td></tr>`
    }
  }
}

function blockText(b: Block, values: string[]): string {
  const t = (s: string) => inlineText(s, values)
  switch (b.kind) {
    case 'heading':
      return t(b.text)
    case 'rule':
      return '————'
    case 'button':
      return `${t(b.label)}: ${resolve(b.url, values)}`
    case 'note':
    case 'paragraph':
      return b.lines.map(t).join('\n')
    case 'table':
      return b.rows
        .map((cells) => {
          const parts = cells.map(t).filter((c) => c.trim())
          return cells.length === 2 ? parts.join(': ') : parts.join(' · ')
        })
        .join('\n')
  }
}

/** The first paragraph, as inbox preview text. */
function preheader(blocks: Block[], values: string[]): string {
  const p = blocks.find((b) => b.kind === 'paragraph')
  return p && p.kind === 'paragraph' ? inlineText(p.lines.join(' '), values).slice(0, 140) : ''
}

export function layoutHtml(inner: string, opts: { subject: string; preheader: string; brand: Brand }): string {
  const { brand } = opts
  const site = escapeHtml(safeUrl(brand.siteUrl))
  const support = escapeHtml(brand.supportEmail)
  const footer = [
    `Questions? Reply to this email or write to <a href="mailto:${support}" style="color:${INK[500]};text-decoration:underline">${support}</a>.`,
    brand.address ? escapeHtml(brand.address) : '',
  ]
    .filter(Boolean)
    .join('<br>')
  return `<!doctype html>
<html lang="${langOf(brand.lang)}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(opts.subject)}</title>
<style>
  @media (max-width:620px){ .v-card{width:100%!important} .v-pad{padding-left:24px!important;padding-right:24px!important} }
  a{color:${INK[900]}}
</style>
</head>
<body style="margin:0;padding:0;background:${INK[50]};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(opts.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK[50]}" style="background:${INK[50]}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" class="v-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK[0]}" style="width:600px;max-width:600px;background:${INK[0]};border:1px solid ${INK[200]}">
<tr><td class="v-pad" align="center" style="padding:34px 48px 30px;border-bottom:1px solid ${INK[200]}">
<a href="${site}" style="font-family:${SANS};font-size:22px;line-height:1;font-weight:300;letter-spacing:0.42em;padding-left:0.42em;text-transform:uppercase;color:${INK[900]};text-decoration:none">${escapeHtml(brand.storeName.toUpperCase())}</a>
</td></tr>
<tr><td class="v-pad" style="padding:40px 48px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${inner}</table>
</td></tr>
<tr><td class="v-pad" style="padding:22px 48px 30px;border-top:1px solid ${INK[200]};font-family:${SANS};font-size:12px;line-height:1.6;font-weight:300;color:${INK[500]}">${footer}</td></tr>
</table>
<table role="presentation" width="600" class="v-card" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td align="center" style="padding:18px 12px 0;font-family:${SANS};font-size:11px;line-height:1.6;letter-spacing:0.16em;text-transform:uppercase;color:${INK[400]}"><a href="${site}" style="color:${INK[400]};text-decoration:none">${escapeHtml(brand.siteUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

/** Render a template (subject + body) with variables into HTML and plain text. */
export function renderEmail(tpl: { subject: string; body: string }, vars: TemplateVars, brand: Brand): Rendered {
  const subject = substitute(tpl.subject, vars) || brand.storeName
  const { text: expanded, values } = expand(tpl.body, vars)
  const blocks = toBlocks(expanded, values)
  const inner = blocks.map((b) => blockHtml(b, values)).join('\n')
  const html = layoutHtml(inner, { subject, preheader: preheader(blocks, values), brand })
  const bodyText = blocks.map((b) => blockText(b, values)).join('\n\n')
  const text = [
    brand.storeName.toUpperCase().split('').join(' '),
    '',
    bodyText,
    '',
    '————',
    `Questions? Reply to this email or write to ${brand.supportEmail}.`,
    ...(brand.address ? [brand.address] : []),
    brand.siteUrl,
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')
    .trim()
  return { subject, html, text }
}
