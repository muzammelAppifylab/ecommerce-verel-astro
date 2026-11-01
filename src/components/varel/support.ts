/*
 * Presentation helpers the design system needs, ported from VAREL `src/lib/format.ts` and `src/lib/product.ts`.
 *
 * WAVE 0 NOTE: F4 owns the shared copies (`src/lib/format.ts`, `src/lib/product.ts`) and F3 the API types
 * (`src/lib/types/*`). Wave 0 packages merge F1→F2→F3→F4, so this package cannot import them yet; these are
 * the same functions and structurally identical types, kept here so the design system compiles on its own.
 * After the Wave 0 merge the integrator may re-export them from there (Request in docs/migration/handoff/F2.md).
 */

/* ── Types (structural subset of VAREL `src/lib/api/types.ts`) ── */

export type StockState = 'in' | 'low' | 'out' | 'digital';

export interface Photo {
  /** Base URL without size params; the client appends ?auto=format&fit=crop&w=…&q=80 */
  src: string;
  credit?: string;
  creditHref?: string;
}

export interface Swatch {
  /** English colour name: the selection value (matches Variant.color) */
  name: string;
  hex: string;
  /** Colour name in the request language (display only) */
  label?: string;
}

export interface VariantLike {
  id: string;
  color: string | null;
  size: string | null;
  inventory: number | null;
}

/** The product fields the tiles read (VAREL `Product`, money in major units as the storefront API sends it). */
export interface ProductLike {
  id: string;
  name: string;
  dept: string;
  category: string;
  deptLabel?: string;
  categoryLabel?: string;
  type: 'physical' | 'digital';
  price: number;
  compareAt: number | null;
  material: string;
  image: Photo | null;
  alt: string;
  variants: VariantLike[];
  stock: StockState;
  stockLabel: string;
  badge: string | null;
  onSale: boolean;
  swatches: Swatch[];
  promotion: {label: string; discountId?: string} | null;
  allowBackorder?: boolean;
  rating: {avg: number; count: number} | null;
}

/* ── Images (VAREL photoUrl / photoSrcSet) ── */

/** Unsplash URL for a Photo at a given width: `${src}?auto=format&fit=crop&w=${w}&q=80`. */
export function photoUrl(photo: Pick<Photo, 'src'> | string, w = 1000): string {
  const src = typeof photo === 'string' ? photo : photo.src;
  if (!src) return '';
  const sep = src.includes('?') ? '&' : '?';
  return `${src}${sep}auto=format&fit=crop&w=${w}&q=80`;
}

/** `srcSet` string for responsive images (widths in px). */
export function photoSrcSet(photo: Pick<Photo, 'src'> | string, widths = [400, 800, 1200, 1600]): string {
  return widths.map(w => `${photoUrl(photo, w)} ${w}w`).join(', ');
}

/* ── Money (VAREL money / priceText) ── */

const CURRENCY_LOCALE: Record<string, string> = {DKK: 'da-DK', SEK: 'sv-SE', NOK: 'nb-NO', ISK: 'is-IS'};
const INTL_LOCALE: Record<string, string> = {
  en: 'en-US',
  da: 'da-DK',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  sv: 'sv-SE',
};
const formatters = new Map<string, Intl.NumberFormat>();

/** Store currency and language for `money()`; the storefront layout sets them from the public settings. */
const moneyContext = {currency: 'USD', locale: 'en'};

/** Point `money()` at the store currency (ISO 4217) and the page language. Unknown codes are ignored. */
export function setMoneyContext(currency: string | null | undefined, locale?: string | null): void {
  const c = (currency ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c) && formatterFor(c, false, moneyContext.locale)) moneyContext.currency = c;
  if (locale) moneyContext.locale = locale;
}

/* In the browser, islands read the store currency and page language from the page itself: the storefront
   layouts render `data-store-currency` on their root and `lang` on <html>. Read once per page body (a client
   navigation swaps the body). */
let syncedBody: HTMLElement | null = null;
function syncFromDocument(): void {
  if (typeof document === 'undefined' || !document.body || syncedBody === document.body) return;
  syncedBody = document.body;
  const currency = document.querySelector<HTMLElement>('[data-store-currency]')?.dataset.storeCurrency;
  setMoneyContext(currency, document.documentElement.lang || null);
}

function numberLocale(currency: string, lng: string): string {
  if (lng === 'en') return CURRENCY_LOCALE[currency] ?? 'en-US';
  return INTL_LOCALE[lng] ?? lng;
}

function formatterFor(currency: string, fraction: boolean, lng: string): Intl.NumberFormat | null {
  const tag = numberLocale(currency, lng);
  const key = `${tag}:${currency}:${fraction}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(tag, {
        style: 'currency',
        currency,
        minimumFractionDigits: fraction ? 2 : 0,
        maximumFractionDigits: 2,
      });
    } catch {
      return null;
    }
    formatters.set(key, f);
  }
  return f;
}

/** `$148`, `$1,240`, `$24.60`, `€148`, `148 kr.`: whole amounts without decimals, two when fractional. */
export function money(n: number | string, currency?: string | null): string {
  syncFromDocument();
  const v = Math.round(Number(n) * 100) / 100;
  const whole = Number.isInteger(v);
  const f =
    formatterFor((currency || moneyContext.currency).toUpperCase(), !whole, moneyContext.locale) ??
    formatterFor('USD', !whole, 'en')!;
  return f.format(v);
}

/** Like `money()` but a price of 0 reads `free` (pass the translated word). */
export function priceText(n: number, free = 'Free'): string {
  return n === 0 ? free : money(n);
}

/** Metadata joined with a middle dot: `Stone · M · Qty 1`. Falsy parts are skipped. */
export function dotJoin(...parts: Array<string | number | null | undefined | false>): string {
  return parts.filter(p => p !== null && p !== undefined && p !== false && p !== '').join(' · ');
}

/* ── Product presentation (VAREL src/lib/product.ts) ── */

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

/** Badge tone on product media: a sold-out piece that is not on sale is quiet, everything else ink. */
export function badgeTone(badge: string | null | undefined, p: Pick<ProductLike, 'stock' | 'compareAt'>): 'ink' | 'quiet' {
  return badge && p.stock === 'out' && !p.compareAt ? 'quiet' : 'ink';
}

/** "Women · Knitwear · Merino wool" */
export function productMeta(p: Pick<ProductLike, 'dept' | 'category' | 'material' | 'deptLabel' | 'categoryLabel'>): string {
  return [p.deptLabel ?? p.dept, p.categoryLabel ?? p.category, p.material].filter(Boolean).join(' · ');
}

/** Price strings for a product: { price: "$148" | "Free", compareAt: "$180" | undefined } */
export function productPrice(p: Pick<ProductLike, 'price' | 'compareAt'>, free = 'Free') {
  return {price: priceText(p.price, free), compareAt: p.compareAt ? money(p.compareAt) : undefined};
}

/** First in-stock variant (optionally preferring a colour), used by tile quick-add. Backorder products: any variant. */
export function firstAvailableVariant(p: Pick<ProductLike, 'variants' | 'allowBackorder'>, preferColor?: string | null) {
  const avail = (v: VariantLike) => !!p.allowBackorder || v.inventory === null || v.inventory > 0;
  return (preferColor ? p.variants.find(v => v.color === preferColor && avail(v)) : undefined) ?? p.variants.find(avail);
}

/* ── Sizes the CSP-safe components know as classes (the CSP forbids style="") ── */

/** `size-[Npx]` for the pixel sizes the storefront uses; null for others (applied through element.style). */
export const PX_SIZE: Record<number, string> = {
  12: 'size-[12px]',
  13: 'size-[13px]',
  14: 'size-[14px]',
  16: 'size-[16px]',
  18: 'size-[18px]',
  20: 'size-[20px]',
  21: 'size-[21px]',
  22: 'size-[22px]',
  24: 'size-[24px]',
  26: 'size-[26px]',
  28: 'size-[28px]',
  32: 'size-[32px]',
  34: 'size-[34px]',
  36: 'size-[36px]',
  40: 'size-[40px]',
  44: 'size-[44px]',
  48: 'size-[48px]',
};
