/* TEMPORARY copy of WP-12's `countryName` (VAREL src/pages/checkout/countries.ts), so the order screens build before
   WP-12 merges. The integrator replaces imports of this file with `@/components/checkout/countries` and deletes it
   (WP-14 hand-off, Requests). Country names stay English in the data; only the label is localised. */
import {INTL_LOCALE} from '@/lib/i18n';

const CODES: Record<string, string> = {
  Australia: 'AU', Austria: 'AT', Belgium: 'BE', Bulgaria: 'BG', Canada: 'CA', Croatia: 'HR', Cyprus: 'CY',
  Czechia: 'CZ', Denmark: 'DK', Estonia: 'EE', Finland: 'FI', France: 'FR', Germany: 'DE', Greece: 'GR',
  Hungary: 'HU', Iceland: 'IS', Ireland: 'IE', Italy: 'IT', Japan: 'JP', Latvia: 'LV', Lithuania: 'LT',
  Luxembourg: 'LU', Malta: 'MT', Netherlands: 'NL', 'New Zealand': 'NZ', Norway: 'NO', Poland: 'PL',
  Portugal: 'PT', Romania: 'RO', Singapore: 'SG', Slovakia: 'SK', Slovenia: 'SI', 'South Korea': 'KR',
  Spain: 'ES', Sweden: 'SE', Switzerland: 'CH', 'United Kingdom': 'GB', 'United States': 'US',
};

const cache = new Map<string, Intl.DisplayNames | null>();
function displayNames(locale: string): Intl.DisplayNames | null {
  if (!cache.has(locale)) {
    try {
      cache.set(locale, new Intl.DisplayNames([INTL_LOCALE[locale] ?? locale], {type: 'region'}));
    } catch {
      cache.set(locale, null);
    }
  }
  return cache.get(locale) ?? null;
}

/** "Germany" → "Deutschland" (de). English (and unknown names) are returned unchanged. */
export function countryName(name: string, locale: string): string {
  if (!name || locale === 'en') return name;
  const code = CODES[name];
  return (code && displayNames(locale)?.of(code)) || name;
}
