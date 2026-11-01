/*
 * SEO helpers for the collection pages (VAREL worker/routes/html.ts `clip`, `absImage` and the collection
 * meta block). Pure functions, safe on the server and in tests. I1 may move them into src/lib/seo.ts.
 */
import type {ProductLike} from '@/components/varel/support';
import type {Product} from '@/lib/types/catalog';
import type {CollectionSummary} from '@/lib/types/collections';
import {toPlainText} from '@/lib/rich-text';

/** VAREL `clip`: collapse whitespace; over `max`, cut at a word (not before max - 30), drop trailing punctuation, add "…". */
export function clipDescription(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,.;:\s]+$/, '')}…`;
}

/** VAREL `absImage`: a share-card image URL; Unsplash bases get the 1200×630 crop. Site paths stay paths (Base makes them absolute). */
export function socialImage(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith('/')) return src.startsWith('//') ? null : src;
  if (/^https:\/\/images\.unsplash\.com\//.test(src) && !src.includes('w=')) {
    return `${src}${src.includes('?') ? '&' : '?'}auto=format&fit=crop&w=1200&h=630&q=80`;
  }
  return /^https:\/\//i.test(src) ? src : null;
}

/** The meta description of a collection page: SEO description, else its plain text, else the store's. */
export function collectionDescription(c: Pick<CollectionSummary, 'seoDescription' | 'description'>, fallback = ''): string {
  return clipDescription(c.seoDescription || toPlainText(c.description) || fallback);
}

/** schema.org `CollectionPage` (VAREL's JSON-LD for `/collections/<slug>`). */
export function collectionJsonLd(input: {name: string; description: string; url: string | null; locale: string}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: input.name,
    description: input.description,
    ...(input.url ? {url: input.url} : {}),
    inLanguage: input.locale,
  };
}

/** Only what a product tile reads (ProductGridItem's `ProductLike`): keeps the island's props small. */
export function toTileProduct(p: Product): ProductLike {
  return {
    id: p.id,
    name: p.name,
    dept: p.dept,
    category: p.category,
    deptLabel: p.deptLabel,
    categoryLabel: p.categoryLabel,
    type: p.type,
    price: p.price,
    compareAt: p.compareAt,
    material: p.material,
    image: p.image,
    alt: p.alt,
    variants: p.variants.map(v => ({id: v.id, color: v.color, size: v.size, inventory: v.inventory})),
    stock: p.stock,
    stockLabel: p.stockLabel,
    badge: p.badge,
    onSale: p.onSale,
    swatches: p.swatches,
    promotion: p.promotion,
    allowBackorder: p.allowBackorder,
    rating: p.rating,
  };
}
