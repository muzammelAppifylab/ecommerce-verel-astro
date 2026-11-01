/*
 * Pure helpers for the CMS / policy pages (WP-07), shared by the storefront pages, the Site API and the
 * dashboard: no React, no Astro, no server-only imports.
 *
 * Ported from VAREL `src/pages/policy/PolicyLayout.tsx` (`longDate`, class constants),
 * `src/pages/policy/CmsPolicy.tsx` (`splitSections`, `asRows`), `src/lib/studio-contact.ts` (`studioContact`),
 * `worker/routes/html.ts` (`pagePath`) and `src/lib/admin/cms.ts` (`storefrontPagePath`).
 */
import {INTL_LOCALE} from '@/lib/i18n/locales';
import {slugify} from '@/lib/format';
import type {PostBlock} from '@/lib/types/content';

/* ─── Paths ─────────────────────────────────────────────────────────────── */

/** Pages the storefront already serves at their own address (with a built-in copy). */
export const BUILT_IN_PAGES = ['privacy', 'terms'] as const;

export const isBuiltInPage = (slug: string) => (BUILT_IN_PAGES as readonly string[]).includes(slug);

/** Where a CMS page lives on the storefront (no locale prefix, trailing slash): privacy and terms have their own pages. */
export const pagePath = (slug: string) => (isBuiltInPage(slug) ? `/${slug}/` : `/pages/${slug}/`);

/** VAREL `storefrontPagePath` (the dashboard's "On the store at" and "View" links). */
export const storefrontPagePath = pagePath;

/** Slug rule of CMS pages (server and dashboard). */
export const PAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* ─── Classes (VAREL PolicyLayout) ──────────────────────────────────────── */

export const GUTTER = 'px-6 md:px-12';
export const META = 'text-[11px] leading-snug tracking-label uppercase text-text-muted';
export const PAGE_TITLE = 'm-0 font-display text-[40px] font-normal leading-tight tracking-display md:text-[56px]';

/** Small tracked links/buttons used at the end of sections. */
export const outlineAction =
  'self-start border border-strong px-6 py-3.5 text-[11px] leading-snug tracking-label uppercase text-text-primary transition-hover hover:border-strong hover:bg-ink-900 hover:text-text-inverse';
export const solidAction =
  'border border-transparent bg-ink-900 px-6 py-[15px] text-[11px] leading-snug tracking-label uppercase text-text-inverse transition-hover hover:border-transparent hover:bg-ink-700 hover:text-text-inverse';
export const underlineAction = 'self-start border-b border-strong pb-[3px] text-[11px] leading-snug tracking-label uppercase';

/* ─── Dates ─────────────────────────────────────────────────────────────── */

/** "1 August 2026" in the storefront language (English keeps the day-first en-GB form). */
export function longDate(d: string | Date, locale: string): string {
  const tag = locale === 'en' ? 'en-GB' : (INTL_LOCALE[locale] ?? locale);
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(tag, {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
}

/** Date of the built-in privacy and terms copy (VAREL `new Date(2026, 7, 1)`). */
export const FALLBACK_UPDATED = new Date(Date.UTC(2026, 7, 1));

/* ─── CMS policy body ───────────────────────────────────────────────────── */

export interface PolicySectionData {
  id: string;
  title: string;
  blocks: PostBlock[];
}

/** Blocks before the first heading are the lead; every heading starts a section (id: slug of its text). */
export function splitSections(body: PostBlock[]): {lead: PostBlock[]; sections: PolicySectionData[]} {
  const lead: PostBlock[] = [];
  const sections: PolicySectionData[] = [];
  for (const b of body) {
    if (b.type === 'h2') sections.push({id: slugify(b.text) || `section-${sections.length + 1}`, title: b.text, blocks: []});
    else if (sections.length) sections[sections.length - 1]!.blocks.push(b);
    else lead.push(b);
  }
  return {lead, sections};
}

const ROW = /^(.{1,40}?)\s+[—–]\s+(.+)$/;

/** "Label — value" list items as label/value rows, only when EVERY item has that form. */
export function asRows(items: string[]): [string, string][] | null {
  const rows = items.map(i => ROW.exec(i));
  return rows.every(Boolean) ? rows.map(m => [m![1]!, m![2]!] as [string, string]) : null;
}

/** Contents entries from the h2 blocks (ids equal the heading anchors the body renders). */
export function headingsOf(body: PostBlock[]): {id: string; text: string}[] {
  return body.filter((b): b is Extract<PostBlock, {type: 'h2'}> => b.type === 'h2').map(b => ({id: slugify(b.text), text: b.text}));
}

/** The first paragraph's text (meta description fallback). */
export const firstParagraph = (body: PostBlock[]) => body.find((b): b is Extract<PostBlock, {type: 'p'}> => b.type === 'p')?.text ?? '';

/** Clip text for a meta description (~160 characters, on a word). */
export function clip(text: string, max = 160): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 80 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/* ─── Studio contact (VAREL src/lib/studio-contact.ts) ──────────────────── */

/** Fallbacks: equal to the seeded settings. */
export const STUDIO_EMAIL = 'care@varel.studio';
export const STUDIO_PHONE = '(+45) 00 00 20 40';

export interface StudioContact {
  email: string;
  phone: string;
  /** tel: link target: digits and a leading + only */
  phoneHref: string;
  /** Business address lines from settings, or null to use the translated studio address */
  addressLines: string[] | null;
}

export const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Store settings win (Admin → Settings: support email, phone, business address); fallbacks until they are filled in. */
export function studioContact(settings: {supportEmail?: string | null; phone?: string | null; businessAddress?: string | null} | null | undefined): StudioContact {
  const email = settings?.supportEmail?.trim() || STUDIO_EMAIL;
  const phone = settings?.phone?.trim() || STUDIO_PHONE;
  const address = settings?.businessAddress?.trim();
  const addressLines = address
    ? address
        .split(/\n|,\s*(?=\d)/)
        .map(l => l.trim())
        .filter(Boolean)
    : null;
  return {email, phone, phoneHref: telOf(phone), addressLines};
}

/** Contact topics. `label` stays English: it becomes the email subject the studio reads. */
export const CONTACT_TOPICS = [
  {value: 'order', label: 'An existing order', order: true},
  {value: 'sizing', label: 'Sizing and fit', order: false},
  {value: 'repair', label: 'Repairs', order: true},
  {value: 'return', label: 'Returns and refunds', order: true},
  {value: 'stockist', label: 'Stockists and wholesale', order: false},
  {value: 'press', label: 'Press', order: false},
] as const;

export const topicMailto = (email: string, subject: string, withOrder: boolean) =>
  `mailto:${email}?subject=${encodeURIComponent(withOrder ? `${subject} · Order VRL-` : subject)}`;
