/* Labels for Settings · Languages (VAREL src/lib/admin/translations.ts "Labels"). The admin is English-only. */
import {SHIPPED_LOCALES} from '../../../../lib/i18n/locales';
import type {LocaleCoverage, TranslationStatus} from '../../../../lib/types/admin/translations';
import type {Tone} from '../../../ui';

/** English names of common languages for the admin (the storefront switcher uses native names). */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  da: 'Danish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  sv: 'Swedish',
  nb: 'Norwegian',
  fi: 'Finnish',
  is: 'Icelandic',
  nl: 'Dutch',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  cs: 'Czech',
  et: 'Estonian',
  lv: 'Latvian',
  lt: 'Lithuanian',
  el: 'Greek',
  hu: 'Hungarian',
  ro: 'Romanian',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  he: 'Hebrew',
  hi: 'Hindi',
};

export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code.toUpperCase();

/**
 * Languages the storefront can serve at their own address (`/da/…`): the middleware routes only the languages
 * with shipped catalogs (F4 `PREFIXED_LOCALES`). A language outside this set would get a switcher link that
 * answers 404, so the admin offers only these until the routable set grows (request R3). VAREL let any code in.
 */
export const ROUTABLE_LOCALES: readonly string[] = SHIPPED_LOCALES;

/** Languages with shipped interface catalogs; others get a machine-translated interface (request R4). */
export const SHIPPED = new Set<string>(SHIPPED_LOCALES);

/** The server's rule for a language code (`/^[a-z]{2,3}$/` after lower-casing). */
export const CODE_RE = /^[a-z]{2,3}$/;

/** A typed code as the server stores it. */
export const normCode = (v: string) => v.trim().toLowerCase();

export const ENTITY_LABELS: Record<string, string> = {
  product: 'Products',
  option: 'Colours',
  department: 'Departments',
  category: 'Categories',
  post: 'Journal posts',
  post_category: 'Journal categories',
  page: 'Pages',
  collection: 'Collections',
  menu: 'Menus',
  shipping_method: 'Shipping methods',
  discount: 'Discounts',
  email_template: 'Email templates',
  setting: 'Store texts',
  ui: 'Interface text',
};
export const entityLabel = (e: string) => ENTITY_LABELS[e] ?? e;

export const STATUS_LABEL: Record<TranslationStatus, string> = {missing: 'Missing', stale: 'Outdated', auto: 'Auto', manual: 'Edited'};
export const STATUS_TONE: Record<TranslationStatus, Tone> = {missing: 'danger', stale: 'warning', auto: 'neutral', manual: 'brand'};

/** Share translated, 100 when there is nothing to translate. */
export const pct = (c?: LocaleCoverage) => (c && c.total ? Math.floor((c.translated / c.total) * 100) : 100);
/** Missing + outdated. */
export const todo = (c?: LocaleCoverage) => (c ? c.missing + c.stale : 0);

export function looksJson(s: string) {
  const t = s.trim();
  if (!(t.startsWith('[') || t.startsWith('{'))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/** A structured value's text leaves, joined (links, ids and images left out). */
export function jsonText(s: string): string {
  const out: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      if (key && ['url', 'href', 'src', 'id', 'type', 'slug'].includes(key)) return;
      if (v.trim() && !/^(https?:|\/)/.test(v)) out.push(v);
    } else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'image') walk(x, k);
  };
  try {
    walk(JSON.parse(s));
  } catch {
    return s;
  }
  return out.join(' · ');
}
