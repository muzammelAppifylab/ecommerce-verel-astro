/* Country names in the shopper's language (VAREL src/pages/checkout/countries.ts). The API lists (and stores)
   countries by English name, which stays the form value; only the label is localised with Intl.DisplayNames.
   TEMPORARY copy: WP-12 owns `src/components/checkout/countries.ts` (same exports); the integrator may point
   the account app at it and delete this file once WP-12 is merged. */
import { INTL_LOCALE } from '@/lib/i18n/locales'

const CODES: Record<string, string> = {
  Australia: 'AU', Austria: 'AT', Belgium: 'BE', Bulgaria: 'BG', Canada: 'CA', Croatia: 'HR', Cyprus: 'CY',
  Czechia: 'CZ', Denmark: 'DK', Estonia: 'EE', Finland: 'FI', France: 'FR', Germany: 'DE', Greece: 'GR',
  Hungary: 'HU', Iceland: 'IS', Ireland: 'IE', Italy: 'IT', Japan: 'JP', Latvia: 'LV', Lithuania: 'LT',
  Luxembourg: 'LU', Malta: 'MT', Netherlands: 'NL', 'New Zealand': 'NZ', Norway: 'NO', Poland: 'PL',
  Portugal: 'PT', Romania: 'RO', Singapore: 'SG', Slovakia: 'SK', Slovenia: 'SI', 'South Korea': 'KR',
  Spain: 'ES', Sweden: 'SE', Switzerland: 'CH', 'United Kingdom': 'GB', 'United States': 'US',
}

const cache = new Map<string, Intl.DisplayNames | null>()
function displayNames(locale: string): Intl.DisplayNames | null {
  if (!cache.has(locale)) {
    try {
      cache.set(locale, new Intl.DisplayNames([INTL_LOCALE[locale] ?? locale], { type: 'region' }))
    } catch {
      cache.set(locale, null)
    }
  }
  return cache.get(locale) ?? null
}

/** "Germany" → "Deutschland" (de). English (and unknown names) are returned unchanged. */
export function countryName(name: string, locale: string): string {
  if (!name || locale === 'en') return name
  const code = CODES[name]
  return (code && displayNames(locale)?.of(code)) || name
}

/** Select options with English values and localised labels; the first entry (the store's home country) stays first. */
export function countryOptions(names: string[], locale: string): Array<{ value: string; label: string }> {
  const opts = names.map((n) => ({ value: n, label: countryName(n, locale) }))
  if (locale === 'en' || opts.length < 3) return opts
  const [first, ...rest] = opts
  return [first!, ...rest.sort((a, b) => a.label.localeCompare(b.label, INTL_LOCALE[locale] ?? locale))]
}
