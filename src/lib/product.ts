/* Presentation helpers for API products — mirror the prototype's renderVals() logic (port of VAREL
   src/lib/product.ts). VAREL read labels from the global i18next instance; here the label helpers take the
   `product` namespace translator (`useT(dict, 'product')` in an island, `tFor(locale, 'product')` on a page),
   defaulting to English. Types are structural so these work on the API contract (`src/lib/types`) as is. */
import {money, priceText} from './format';
import type {TFunction} from './i18n/core';

export type StockState = 'in' | 'low' | 'out' | 'digital';

interface VariantLike {
  color: string | null;
  size: string | null;
  inventory: number | null;
  options?: Record<string, string> | null;
}

interface ProductLike<V extends VariantLike = VariantLike> {
  variants: V[];
  sizes: string[];
  allowBackorder?: boolean;
}

/** English `product` strings the helpers fall back to without a translator. */
const EN: Record<string, string> = {
  'tile.soldOut': 'Sold out',
  'tile.download': 'Download',
  'tile.addedToBag': 'Added to bag',
  'tile.addToBag': 'Add to bag',
  'stock.backorder': 'Made to order · ships in 2–3 weeks',
  'stock.digitalNoShipping': 'Digital · no shipping',
  'stock.lowLeft_one': 'Only {{count}} left',
  'stock.lowLeft_other': 'Only {{count}} left',
  'stock.inStock': 'In stock',
};

const english: TFunction = (key, vars) => {
  const k = typeof vars?.count === 'number' ? (vars.count === 1 ? `${key}_one` : `${key}_other`) : key;
  return (EN[k] ?? EN[key] ?? key).replace(/\{\{(\w+)\}\}/g, (w, n: string) => (vars?.[n] == null ? w : String(vars[n])));
};

/** Colourway hexes (varel-store.js SWATCH). The API also returns `swatch` per variant. */
export const SWATCH: Record<string, string> = {
  Black: '#1A1A1A',
  Stone: '#CFC8BE',
  Olive: '#6B6A57',
  Navy: '#2B3242',
  Bone: '#E4DED4',
  Camel: '#B39271',
  Charcoal: '#3A3B3D',
  Oat: '#DDD3C2',
  Tan: '#A9835F',
  Steel: '#B8BCC2',
  White: '#F4F2EE',
  Chalk: '#F5F5F5',
};

/** Tailwind text colour class for a stock state (STOCK_COLOR in varel-store.js). */
export const STOCK_TEXT: Record<StockState, string> = {
  in: 'text-text-muted',
  low: 'text-signal-notice',
  out: 'text-signal-critical',
  digital: 'text-signal-positive',
};

/** Badge tone used on product media: "Sold out" is quiet, everything else ink.
 *  Pass the product when you have it: the badge text arrives translated, so its stock decides (the API shows
 *  "Sold out" for sold-out pieces that are not on sale). */
export function badgeTone(
  badge: string | null | undefined,
  p?: {stock: StockState; compareAt: number | null},
  t: TFunction = english,
): 'ink' | 'quiet' {
  if (p) return badge && p.stock === 'out' && !p.compareAt ? 'quiet' : 'ink';
  return badge === 'Sold out' || badge === t('tile.soldOut') ? 'quiet' : 'ink';
}

/** "Women · Knitwear · Merino wool" */
export function productMeta(p: {
  dept: string;
  category: string;
  material: string;
  deptLabel?: string | null;
  categoryLabel?: string | null;
}): string {
  return [p.deptLabel ?? p.dept, p.categoryLabel ?? p.category, p.material].filter(Boolean).join(' · ');
}

/** Price strings for a product: { price: "$148" | "Free", compareAt: "$180" | undefined } */
export function productPrice(p: {price: number; compareAt: number | null}, locale?: string | null) {
  return {price: priceText(p.price, locale), compareAt: p.compareAt ? money(p.compareAt, null, locale) : undefined};
}

/** Quick-add button label used on tiles. */
export function addLabel(p: {stock: StockState; type: string}, added = false, t: TFunction = english): string {
  if (p.stock === 'out') return t('tile.soldOut');
  if (p.type === 'digital') return t('tile.download');
  return added ? t('tile.addedToBag') : t('tile.addToBag');
}

/** Resolve a variant from colour + size, plus any custom options chosen (prototype `variantOf()`). */
export function variantOf<V extends VariantLike>(
  p: ProductLike<V>,
  color?: string | null,
  size?: string | null,
  custom: Record<string, string> = {},
): V | undefined {
  return p.variants.find(
    v =>
      (color == null || v.color === color) &&
      (size == null || v.size === size) &&
      Object.entries(custom).every(([name, value]) => (v.options ?? {})[name] === value),
  );
}

/** Label for backorder pieces with nothing on hand (Product.allowBackorder): "Made to order · ships in 2–3 weeks". */
export const backorderText = (t: TFunction = english): string => t('stock.backorder');

/** First in-stock variant (optionally preferring a colour) — used by tile quick-add. Backorder products: any variant. */
export function firstAvailableVariant<V extends VariantLike>(p: ProductLike<V>, preferColor?: string | null): V | undefined {
  const avail = (v: V) => !!p.allowBackorder || v.inventory === null || v.inventory > 0;
  return (preferColor ? p.variants.find(v => v.color === preferColor && avail(v)) : undefined) ?? p.variants.find(avail);
}

/** Sizes with zero inventory for a given colour (for SizeSelector soldOut). */
export function soldOutSizes(p: ProductLike, color?: string | null): string[] {
  if (p.allowBackorder) return [];
  return p.sizes.filter(s => {
    const vs = p.variants.filter(v => v.size === s && (color == null || v.color === color));
    return vs.length > 0 && vs.every(v => v.inventory !== null && v.inventory <= 0);
  });
}

/** Cart line stock line + colour (Cart prototype). */
export function lineStock(
  l: {digital: boolean; inventory: number | null; backorder?: boolean},
  t: TFunction = english,
): {label: string; className: string} {
  if (l.digital) return {label: t('stock.digitalNoShipping'), className: 'text-signal-positive'};
  if (l.backorder && l.inventory != null && l.inventory <= 0) return {label: backorderText(t), className: 'text-ink-400'};
  if (l.inventory != null && l.inventory <= 3)
    return {label: t('stock.lowLeft', {count: l.inventory}), className: 'text-signal-notice'};
  return {label: t('stock.inStock'), className: 'text-ink-400'};
}
