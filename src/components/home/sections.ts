/*
 * The home sections' pure rules (no React, no DOM), ported from VAREL src/pages/home/*.tsx so the server
 * render and the islands compute the same thing, and so they can be unit-tested.
 */
import type {Photo} from '../../lib/types/common';
import type {Department, Product, ProductQuery, ProductSort} from '../../lib/types/catalog';
import type {CollectionSummary} from '../../lib/types/collections';
import {categoryLink, shopLink} from '../../lib/links';
import {soldOutSizes} from '../../lib/product';
import {HOME_PHOTOS} from './photos';

/* ── New in (VAREL NewInSection.tsx) ── */

export type FilterKey = 'all' | 'new' | 'women' | 'men' | 'shoes' | 'bags' | 'accessories';

/** Labels: `home:newIn.filters.<key>` */
export const FILTERS: FilterKey[] = ['all', 'new', 'women', 'men', 'shoes', 'bags', 'accessories'];

/** Labels: `home:newIn.sort.<value>` */
export const SORTS: ProductSort[] = ['featured', 'price-asc', 'price-desc'];

export const NEW_IN_LIMIT = 12;

/** The `/products` query for a filter and sort (`new` → `tag=new`, a department → `dept=<slug>`). */
export function queryFor(filter: FilterKey, sort: ProductSort): ProductQuery {
  const q: ProductQuery = {sort, limit: NEW_IN_LIMIT};
  if (filter === 'new') q.tag = 'new';
  else if (filter !== 'all') q.dept = filter;
  return q;
}

/* ── Featured row and collections (VAREL FeaturedEdit.tsx) ── */

/** Whole rows of four when there are at least four (8 → 8, 7 → 4, 6 → 4), else all of them. */
export function featuredSlice<T>(items: readonly T[]): T[] {
  const n = items.length;
  return items.slice(0, n >= 4 ? 4 * Math.floor(n / 4) : n);
}

/** Collections shown on the home: those with pieces, at most three. */
export function featuredCollectionsOf(list: readonly CollectionSummary[] | null | undefined) {
  const items = (list ?? []).filter(c => c.productCount > 0).slice(0, 3);
  return {items, three: items.length === 3};
}

/* ── Featured piece (VAREL FeaturedPiece.tsx) ── */

/** The product spotlighted in the "Featured piece" block. */
export const FEATURED_SLUG = 'atelier-wool-coat';

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/** Stock line under the size picker; 1–6 pieces are spelled out ("Only two left"). `t` = the `home` namespace. */
export function stockFor(inv: number | null | undefined, t: T): {label: string; cls: string} {
  if (inv == null) return {label: t('piece.stock.download'), cls: 'text-signal-positive'};
  if (inv <= 0) return {label: t('piece.stock.soldOut'), cls: 'text-signal-critical'};
  if (inv <= 6) return {label: t('piece.stock.final', {count: inv, word: t(`piece.words.${inv}`)}), cls: 'text-signal-notice'};
  return {label: t('piece.stock.in'), cls: 'text-text-muted'};
}

/** The size picked at first: M when it is in stock for the first colour, else the first size in stock, else the first. */
export function initialSize(p: Pick<Product, 'sizes' | 'swatches' | 'variants' | 'allowBackorder'>): string | null {
  const out = soldOutSizes(p, p.swatches[0]?.name ?? null);
  if (p.sizes.includes('M') && !out.includes('M')) return 'M';
  return p.sizes.find(s => !out.includes(s)) ?? p.sizes[0] ?? null;
}

/* ── The best part (VAREL BestPart.tsx) ── */

/** Rows of the list: name key (`home:bestPart.rows.*`), taxonomy category slug, and the photo shown while lit. */
export const BEST_PART_ROWS: [nameKey: string, slug: string, photo: Photo][] = [
  ['outerwear', 'outerwear', HOME_PHOTOS.featureA],
  ['knitwear', 'knitwear', HOME_PHOTOS.new1a],
  ['shirting', 'shirts', HOME_PHOTOS.new2a],
  ['denim', 'denim', HOME_PHOTOS.bestPart],
];

export interface BestPartRow {
  key: string;
  name: string;
  count: number;
  photo: Photo;
  link: string;
  num: string;
}

/**
 * Each row's piece count (that category summed over the departments) and link (the department with the most
 * pieces in it, else the shop). Once the taxonomy is known, empty categories are not advertised.
 */
export function rowData(
  taxonomy: readonly Department[] | null | undefined,
  nameOf: (key: string) => string,
  locale?: string | null
): BestPartRow[] {
  const rows = BEST_PART_ROWS.map(([nameKey, slug, photo]) => {
    let count = 0;
    let best: {dept: string; count: number} | null = null;
    for (const d of taxonomy ?? []) {
      const c = d.categories.find(x => x.slug === slug);
      if (!c) continue;
      count += c.count;
      if (!best || c.count > best.count) best = {dept: d.slug, count: c.count};
    }
    return {
      key: nameKey,
      name: nameOf(nameKey),
      count,
      photo,
      link: best ? categoryLink(best.dept, slug, locale) : shopLink(locale),
    };
  });
  return (taxonomy ? rows.filter(r => r.count > 0) : rows).map((r, i) => ({...r, num: String(i + 1).padStart(2, '0')}));
}

/** The row the scroll has reached: `p` = how far the section has travelled through the viewport. */
export function scrolledRow(innerHeight: number, rectTop: number, rectHeight: number): number {
  const p = (innerHeight - rectTop) / (innerHeight + rectHeight);
  return Math.max(0, Math.floor(p * BEST_PART_ROWS.length * 1.35));
}

/* ── Accordion (VAREL CollectionsAccordion.tsx) ── */

/** Title and description: `home:collections.items.<id>.title|description` */
export const ACCORDION_ITEMS = [
  {id: 'essentials', year: '2026'},
  {id: 'statement', year: '2026'},
  {id: 'classics', year: '2026'},
  {id: 'seasonal', year: '2026'},
] as const;

/** Open by default (one at a time). */
export const ACCORDION_OPEN = 'classics';

/** `home:values.<key>.title|body` */
export const VALUES = ['materials', 'lasting', 'fit'] as const;
