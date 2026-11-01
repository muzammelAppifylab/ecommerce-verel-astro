/* Journal <head> helpers (port of VAREL worker/routes/html.ts, the `/journal/:slug` meta): the page
   is server-rendered here, so the description, image and JSON-LD go to <Base> as props. */
import {absoluteUrl, type JsonLd} from '../../lib/seo';

/** One line of at most `max` characters, cut at a word boundary with "…" (VAREL `clip`). */
export function clip(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,.;:\s]+$/, '')}…`;
}

/** The social card for a cover: Unsplash bases get the 1200×630 crop (VAREL `absImage`); other sources pass through. */
export function shareImage(src: string | null | undefined): string | null {
  if (!src) return null;
  if (/^https:\/\/images\.unsplash\.com\//.test(src) && !src.includes('w=')) {
    return `${src}${src.includes('?') ? '&' : '?'}auto=format&fit=crop&w=1200&h=630&q=80`;
  }
  return src;
}

/** schema.org `Article` for a journal entry (VAREL html.ts). */
export function articleJsonLd(a: {
  title: string;
  description: string;
  locale: string;
  image: string | null;
  publishedAt: string;
  updatedAt?: string;
  section: string;
  author: string;
  publisher: string;
  canonicalPath: string;
}): JsonLd {
  const image = a.image ? absoluteUrl(a.image) : null;
  const canonical = absoluteUrl(a.canonicalPath);
  const origin = absoluteUrl('/');
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: clip(a.title, 110),
    inLanguage: a.locale,
    description: a.description,
    ...(image && {image: [image]}),
    datePublished: a.publishedAt,
    dateModified: a.updatedAt ?? a.publishedAt,
    articleSection: a.section,
    author: {'@type': 'Person', name: a.author},
    publisher: {'@type': 'Organization', name: a.publisher, ...(origin && {url: origin})},
    ...(canonical && {mainEntityOfPage: {'@type': 'WebPage', '@id': canonical}}),
  };
}
