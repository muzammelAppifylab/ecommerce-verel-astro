/* Product page SEO (port of VAREL worker/routes/html.ts `/product/:slug`: clip, absImage and the Product JSON-LD).
   VAREL injected these into the SPA shell with HTMLRewriter; here they become <Base> props (title, description,
   image, jsonLd). Server only: the values come from the serialised (already translated) `Product`. */
import type {JsonLd} from '@/lib/seo';
import type {Product} from '@/lib/types/catalog';
import {toPlainText} from '@/lib/rich-text';

/** One line, at most `max` characters, cut at a word boundary (VAREL html.ts `clip`). */
export function clip(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,.;:\s]+$/, '')}…`;
}

/**
 * Absolute image URL; Unsplash bases get the share-card crop (VAREL html.ts `absImage`).
 * `abs` turns an on-site path into an absolute URL (`absoluteUrl` from src/lib/seo.ts), null when the site's
 * address is not known (dev, Preview): such images are then left out.
 */
export function absImage(src: string | null | undefined, abs: (path: string) => string | null): string | null {
  if (!src) return null;
  if (src.startsWith('/')) return abs(src);
  if (/^https:\/\/images\.unsplash\.com\//.test(src) && !src.includes('w=')) {
    return `${src}${src.includes('?') ? '&' : '?'}auto=format&fit=crop&w=1200&h=630&q=80`;
  }
  return /^https:\/\//.test(src) ? src : null;
}

/** The meta description: the SEO override (untranslated only, the API nulls it otherwise) ‖ short ‖ description
    as plain text ‖ the store's default description; one line, ≤ 160 characters. */
export function metaDescription(p: Pick<Product, 'seoDescription' | 'short' | 'description'>, fallback?: string | null): string {
  return clip(p.seoDescription || p.short || toPlainText(p.description) || fallback || '');
}

/** schema.org availability (VAREL: a null inventory counts as in stock here, unlike the buy column). */
export function availabilityOf(p: Pick<Product, 'type' | 'variants' | 'allowBackorder'>): 'InStock' | 'BackOrder' | 'OutOfStock' {
  const inStock = p.type !== 'physical' || p.variants.some(v => v.inventory == null || v.inventory > 0);
  return inStock ? 'InStock' : p.allowBackorder ? 'BackOrder' : 'OutOfStock';
}

export interface ProductJsonLdOptions {
  /** The page's canonical URL (absolute), or null when the site's address is not known */
  canonical: string | null;
  currency: string;
  storeName: string;
  locale: string;
  abs: (path: string) => string | null;
}

/** schema.org `Product` (VAREL html.ts): one `Offer` when every variant costs the same, else an `AggregateOffer`. */
export function productJsonLd(p: Product, {canonical, currency, storeName, locale, abs}: ProductJsonLdOptions): JsonLd {
  const prices = p.variants.map(v => v.price).filter(n => Number.isFinite(n));
  const low = prices.length ? Math.min(...prices) : p.price;
  const high = prices.length ? Math.max(...prices) : low;
  const availability = `https://schema.org/${availabilityOf(p)}`;
  const url = canonical ?? undefined;
  const offers =
    low === high
      ? {'@type': 'Offer', price: low.toFixed(2), priceCurrency: currency, availability, url}
      : {
          '@type': 'AggregateOffer',
          lowPrice: low.toFixed(2),
          highPrice: high.toFixed(2),
          priceCurrency: currency,
          offerCount: p.variants.length,
          availability,
          url,
        };
  const images = p.gallery
    .slice(0, 6)
    .map(g => absImage(g.src, abs))
    .filter((s): s is string => !!s);
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: clip(toPlainText(p.description) || p.short, 500),
    sku: p.sku,
    brand: {'@type': 'Brand', name: p.brand || storeName},
    category: p.categoryLabel ?? p.category,
    inLanguage: locale,
    image: images,
    url,
    offers,
  };
  if (p.rating && p.rating.count > 0) {
    data.aggregateRating = {'@type': 'AggregateRating', ratingValue: p.rating.avg, reviewCount: p.rating.count};
  }
  return data;
}
