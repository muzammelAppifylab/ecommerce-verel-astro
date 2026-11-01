export const EU_COUNTRIES = [
  'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Estonia', 'Finland', 'France',
  'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta',
  'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden',
] as const

export const OTHER_COUNTRIES = [
  'Australia', 'Canada', 'Iceland', 'Japan', 'New Zealand', 'Norway', 'Singapore', 'South Korea',
  'Switzerland', 'United Kingdom', 'United States',
] as const

/** Denmark first, then everything else alphabetically. */
export const COUNTRIES: string[] = ['Denmark', ...[...EU_COUNTRIES, ...OTHER_COUNTRIES].sort((a, b) => a.localeCompare(b))]

export const isKnownCountry = (c: string) => COUNTRIES.some((x) => x.toLowerCase() === c.trim().toLowerCase())

/** Canonical casing for a country name ("denmark" → "Denmark"). */
export const canonicalCountry = (c: string) => COUNTRIES.find((x) => x.toLowerCase() === c.trim().toLowerCase()) ?? c.trim()
