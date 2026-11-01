/** Small presentation helpers. No data access here.
 *
 * The template's helpers (`formatMoney`, `initials`) merged with VAREL's src/lib/format.ts (`money`, `priceText`,
 * `formatDate`, `formatDateLong`, `minusMoney`, `photoUrl`, `photoSrcSet`, `pluralize`, `dotJoin`, `slugify`).
 * VAREL read the language from i18next; here every locale-aware helper takes an optional `locale`
 * (pages pass `Astro.locals.locale`; in the browser it defaults to the page's `<html lang>`). Client-safe.
 */
import {currentLocale, DEFAULT_LOCALE, INTL_LOCALE} from './i18n';

/* ─── Money ─────────────────────────────────────────────────────────────── */

/* Store currency (PublicSettings.currency), set once per page by the layout (setMoneyCurrency). */
const CURRENCY_LOCALE: Record<string, string> = {DKK: 'da-DK', SEK: 'sv-SE', NOK: 'nb-NO', ISK: 'is-IS'};
const formatters = new Map<string, Intl.NumberFormat>();
let storeCurrency = 'USD';

const localeOr = (locale?: string | null) => locale || currentLocale() || DEFAULT_LOCALE;

/** Intl tag for numbers: English keeps the currency's home format ($148, 148 kr.); other languages use their own. */
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

/** Set the currency `money()` formats with (ISO 4217, e.g. "EUR"). Unknown codes are ignored. */
export function setMoneyCurrency(code: string | null | undefined): void {
  const c = (code ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c) && formatterFor(c, false, 'en')) storeCurrency = c;
}

/** The currency `money()` uses by default. */
export const moneyCurrency = () => storeCurrency;

/** `$148`, `$1,240`, `$24.60`, `€148`, `148 kr.` — whole amounts without decimals, two decimals when fractional.
 *  Amounts are in currency units (the API contract), not cents. Uses the store currency unless `currency` is
 *  given (orders format with `Order.currency`), in the language's number format (de: `148 $`, `1.240,50 €`). */
export function money(n: number | string, currency?: string | null, locale?: string | null): string {
  const v = Math.round(Number(n) * 100) / 100;
  const lng = localeOr(locale);
  const fraction = !Number.isInteger(v);
  const f = formatterFor((currency || storeCurrency).toUpperCase(), fraction, lng) ?? formatterFor('USD', fraction, lng)!;
  return f.format(v);
}

/** "Free" in each shipped language (common:free), so a price of 0 needs no dictionary. */
const FREE: Record<string, string> = {en: 'Free', da: 'Gratis', de: 'Kostenlos', fr: 'Offert', es: 'Gratis', sv: 'Gratis'};

/** Like `money()` but a price of 0 reads "Free". */
export function priceText(n: number, locale?: string | null, currency?: string | null): string {
  return n === 0 ? (FREE[localeOr(locale)] ?? 'Free') : money(n, currency, locale);
}

/** Negative amount for discount rows: `−$14.80` (true minus sign, as in the prototype). */
export function minusMoney(n: number, currency?: string | null, locale?: string | null): string {
  return '−' + money(Number(n.toFixed(2)), currency, locale);
}

/** "$19.99" from minor units (1999, "USD"); a currency without cents (JPY) is not divided. (Template helper.) */
export function formatMoney(amountCents: number, currency: string, locale = 'en-US'): string {
  try {
    const format = new Intl.NumberFormat(locale, {style: 'currency', currency});
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(amountCents / 10 ** digits);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

/* ─── Dates ─────────────────────────────────────────────────────────────── */

/* English reads "18 Aug 2026" / "18 August 2026" (en-GB, as the prototype); other languages use INTL_LOCALE.
   UTC, so the server and every visitor agree. */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(month: 'short' | 'long', lng: string): Intl.DateTimeFormat {
  const tag = lng === 'en' ? 'en-GB' : (INTL_LOCALE[lng] ?? lng);
  const key = `${tag}:${month}`;
  let f = dateFormatters.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {day: 'numeric', month, year: 'numeric', timeZone: 'UTC'};
    try {
      f = new Intl.DateTimeFormat(tag, opts);
    } catch {
      f = new Intl.DateTimeFormat('en-GB', opts);
    }
    dateFormatters.set(key, f);
  }
  return f;
}

type DateInput = Date | string | number | null | undefined;
const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

/** `18 Aug 2026` (de `18. Aug. 2026`, fr `18 août 2026`). Accepts a Date, ISO string or timestamp; '' when invalid. */
export function formatDate(d: DateInput, locale?: string | null): string {
  if (d === null || d === undefined || d === '') return '';
  const v = toDate(d);
  return Number.isNaN(v.getTime()) ? '' : dateFormatter('short', localeOr(locale)).format(v);
}

/** `18 August 2026` (de `18. August 2026`, da `18. august 2026`). '' when invalid. */
export function formatDateLong(d: DateInput, locale?: string | null): string {
  if (d === null || d === undefined || d === '') return '';
  const v = toDate(d);
  return Number.isNaN(v.getTime()) ? '' : dateFormatter('long', localeOr(locale)).format(v);
}

/* ─── Photos ────────────────────────────────────────────────────────────── */

const RESIZABLE = /^https:\/\/images\.unsplash\.com\//;

/** Unsplash URL for a Photo at a given width: `${src}?auto=format&fit=crop&w=${w}&q=80`.
 *  Only Unsplash understands the sizing parameters; other sources (platform files, /images/…) pass through. */
export function photoUrl(photo: {src: string} | string, w = 1000): string {
  const src = typeof photo === 'string' ? photo : photo.src;
  if (!src) return '';
  if (!RESIZABLE.test(src)) return src;
  const sep = src.includes('?') ? '&' : '?';
  return `${src}${sep}auto=format&fit=crop&w=${w}&q=80`;
}

/** `srcSet` string for responsive images (widths in px); '' for sources that cannot be resized. */
export function photoSrcSet(photo: {src: string} | string, widths = [400, 800, 1200, 1600]): string {
  const src = typeof photo === 'string' ? photo : photo.src;
  if (!RESIZABLE.test(src)) return '';
  return widths.map(w => `${photoUrl(photo, w)} ${w}w`).join(', ');
}

/* ─── Text ──────────────────────────────────────────────────────────────── */

/** "1 piece" / "3 pieces" */
export function pluralize(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Metadata joined with a middle dot: `Stone · M · Qty 1`. Falsy parts are skipped. */
export function dotJoin(...parts: Array<string | number | null | undefined | false>): string {
  return parts.filter(p => p !== null && p !== undefined && p !== false && p !== '').join(' · ');
}

/** Lower-case slug: "Shoulder Bags" → "shoulder-bags". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Initials for the logo-less brand mark and the avatar-less author chip. (Template helper.) */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('');
}
