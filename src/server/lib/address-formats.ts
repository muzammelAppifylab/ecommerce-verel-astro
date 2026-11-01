/* Address formats for the countries we ship to: postcode label, pattern and example, whether the postcode comes
   before the city, the state / province / county list where one is part of the address, and how strict the street
   line is. Patterns, orders and region lists follow Google's address metadata (libaddressinput, chromium-i18n) and
   Shopify checkout. Shared by checkout validation (routes/checkout.ts) and the storefront address form
   (src/pages/checkout/AddressFields.tsx imports this file), so the browser and the API judge an address the same way.
   Countries are stored by English name; the table is keyed by ISO code. */

export type ZipLabel = 'zip' | 'postal' | 'postcode' | 'eircode'
export type RegionLabel = 'state' | 'province' | 'county' | 'stateTerritory' | 'prefecture'

export interface AddressFormat {
  code: string
  zip: {
    label: ZipLabel
    /** Matched against the normalised value (upper case, single spaces) */
    re: RegExp
    example: string
    /** Eircodes are optional (many Irish addresses are found without one) */
    required: boolean
    /** Digits only: the numeric keyboard on phones */
    numeric: boolean
  }
  /** "2100 København Ø" (most of Europe, JP) vs "Austin, TX 78701" (US, GB, AU …) */
  zipFirst: boolean
  region?: {
    label: RegionLabel
    /** [code, name] — the code is what the form sends */
    options: ReadonlyArray<readonly [string, string]>
    /** Written after the city as the code ("Austin, TX") or the name ("Cork, Co. Cork") */
    write: 'code' | 'name' | 'county'
  }
  /** Streets carry a house number as a rule; a street line without a digit is sent back */
  houseNumber: boolean
}

export const COUNTRY_CODES: Record<string, string> = {
  Australia: 'AU', Austria: 'AT', Belgium: 'BE', Bulgaria: 'BG', Canada: 'CA', Croatia: 'HR', Cyprus: 'CY',
  Czechia: 'CZ', Denmark: 'DK', Estonia: 'EE', Finland: 'FI', France: 'FR', Germany: 'DE', Greece: 'GR',
  Hungary: 'HU', Iceland: 'IS', Ireland: 'IE', Italy: 'IT', Japan: 'JP', Latvia: 'LV', Lithuania: 'LT',
  Luxembourg: 'LU', Malta: 'MT', Netherlands: 'NL', 'New Zealand': 'NZ', Norway: 'NO', Poland: 'PL',
  Portugal: 'PT', Romania: 'RO', Singapore: 'SG', Slovakia: 'SK', Slovenia: 'SI', 'South Korea': 'KR',
  Spain: 'ES', Sweden: 'SE', Switzerland: 'CH', 'United Kingdom': 'GB', 'United States': 'US',
}

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
  ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['AS', 'American Samoa'], ['GU', 'Guam'],
  ['MP', 'Northern Mariana Islands'], ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'],
  ['AA', 'Armed Forces Americas'], ['AE', 'Armed Forces Europe'], ['AP', 'Armed Forces Pacific'],
] as const

const CA_PROVINCES = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'], ['NT', 'Northwest Territories'], ['NS', 'Nova Scotia'], ['NU', 'Nunavut'],
  ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
] as const

const AU_STATES = [
  ['ACT', 'Australian Capital Territory'], ['NSW', 'New South Wales'], ['NT', 'Northern Territory'],
  ['QLD', 'Queensland'], ['SA', 'South Australia'], ['TAS', 'Tasmania'], ['VIC', 'Victoria'], ['WA', 'Western Australia'],
] as const

const named = (names: string[]) => names.map((n) => [n, n] as const)

const IE_COUNTIES = named([
  'Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin', 'Galway', 'Kerry', 'Kildare', 'Kilkenny', 'Laois',
  'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan', 'Offaly', 'Roscommon', 'Sligo',
  'Tipperary', 'Waterford', 'Westmeath', 'Wexford', 'Wicklow',
])

const IT_PROVINCES = [
  ['AG', 'Agrigento'], ['AL', 'Alessandria'], ['AN', 'Ancona'], ['AO', 'Aosta'], ['AR', 'Arezzo'], ['AP', 'Ascoli Piceno'],
  ['AT', 'Asti'], ['AV', 'Avellino'], ['BA', 'Bari'], ['BT', 'Barletta-Andria-Trani'], ['BL', 'Belluno'],
  ['BN', 'Benevento'], ['BG', 'Bergamo'], ['BI', 'Biella'], ['BO', 'Bologna'], ['BZ', 'Bolzano'], ['BS', 'Brescia'],
  ['BR', 'Brindisi'], ['CA', 'Cagliari'], ['CL', 'Caltanissetta'], ['CB', 'Campobasso'], ['CE', 'Caserta'],
  ['CT', 'Catania'], ['CZ', 'Catanzaro'], ['CH', 'Chieti'], ['CO', 'Como'], ['CS', 'Cosenza'], ['CR', 'Cremona'],
  ['KR', 'Crotone'], ['CN', 'Cuneo'], ['EN', 'Enna'], ['FM', 'Fermo'], ['FE', 'Ferrara'], ['FI', 'Firenze'],
  ['FG', 'Foggia'], ['FC', 'Forlì-Cesena'], ['FR', 'Frosinone'], ['GE', 'Genova'], ['GO', 'Gorizia'],
  ['GR', 'Grosseto'], ['IM', 'Imperia'], ['IS', 'Isernia'], ['AQ', "L'Aquila"], ['SP', 'La Spezia'], ['LT', 'Latina'],
  ['LE', 'Lecce'], ['LC', 'Lecco'], ['LI', 'Livorno'], ['LO', 'Lodi'], ['LU', 'Lucca'], ['MC', 'Macerata'],
  ['MN', 'Mantova'], ['MS', 'Massa-Carrara'], ['MT', 'Matera'], ['ME', 'Messina'], ['MI', 'Milano'], ['MO', 'Modena'],
  ['MB', 'Monza e Brianza'], ['NA', 'Napoli'], ['NO', 'Novara'], ['NU', 'Nuoro'], ['OR', 'Oristano'], ['PD', 'Padova'],
  ['PA', 'Palermo'], ['PR', 'Parma'], ['PV', 'Pavia'], ['PG', 'Perugia'], ['PU', 'Pesaro e Urbino'], ['PE', 'Pescara'],
  ['PC', 'Piacenza'], ['PI', 'Pisa'], ['PT', 'Pistoia'], ['PN', 'Pordenone'], ['PZ', 'Potenza'], ['PO', 'Prato'],
  ['RG', 'Ragusa'], ['RA', 'Ravenna'], ['RC', 'Reggio Calabria'], ['RE', 'Reggio Emilia'], ['RI', 'Rieti'],
  ['RN', 'Rimini'], ['RM', 'Roma'], ['RO', 'Rovigo'], ['SA', 'Salerno'], ['SS', 'Sassari'], ['SV', 'Savona'],
  ['SI', 'Siena'], ['SR', 'Siracusa'], ['SO', 'Sondrio'], ['SU', 'Sud Sardegna'], ['TA', 'Taranto'], ['TE', 'Teramo'],
  ['TR', 'Terni'], ['TO', 'Torino'], ['TP', 'Trapani'], ['TN', 'Trento'], ['TV', 'Treviso'], ['TS', 'Trieste'],
  ['UD', 'Udine'], ['VA', 'Varese'], ['VE', 'Venezia'], ['VB', 'Verbano-Cusio-Ossola'], ['VC', 'Vercelli'],
  ['VR', 'Verona'], ['VV', 'Vibo Valentia'], ['VI', 'Vicenza'], ['VT', 'Viterbo'],
] as const

const ES_PROVINCES = [
  ['C', 'A Coruña'], ['VI', 'Álava'], ['AB', 'Albacete'], ['A', 'Alicante'], ['AL', 'Almería'], ['O', 'Asturias'],
  ['AV', 'Ávila'], ['BA', 'Badajoz'], ['PM', 'Baleares'], ['B', 'Barcelona'], ['BI', 'Bizkaia'], ['BU', 'Burgos'],
  ['CC', 'Cáceres'], ['CA', 'Cádiz'], ['S', 'Cantabria'], ['CS', 'Castellón'], ['CE', 'Ceuta'], ['CR', 'Ciudad Real'],
  ['CO', 'Córdoba'], ['CU', 'Cuenca'], ['SS', 'Gipuzkoa'], ['GI', 'Girona'], ['GR', 'Granada'], ['GU', 'Guadalajara'],
  ['H', 'Huelva'], ['HU', 'Huesca'], ['J', 'Jaén'], ['LO', 'La Rioja'], ['GC', 'Las Palmas'], ['LE', 'León'],
  ['L', 'Lleida'], ['LU', 'Lugo'], ['M', 'Madrid'], ['MA', 'Málaga'], ['ML', 'Melilla'], ['MU', 'Murcia'],
  ['NA', 'Navarra'], ['OR', 'Ourense'], ['P', 'Palencia'], ['PO', 'Pontevedra'], ['SA', 'Salamanca'],
  ['TF', 'Santa Cruz de Tenerife'], ['SG', 'Segovia'], ['SE', 'Sevilla'], ['SO', 'Soria'], ['T', 'Tarragona'],
  ['TE', 'Teruel'], ['TO', 'Toledo'], ['V', 'Valencia'], ['VA', 'Valladolid'], ['ZA', 'Zamora'], ['Z', 'Zaragoza'],
] as const

const JP_PREFECTURES = named([
  'Hokkaido', 'Aomori', 'Iwate', 'Miyagi', 'Akita', 'Yamagata', 'Fukushima', 'Ibaraki', 'Tochigi', 'Gunma', 'Saitama',
  'Chiba', 'Tokyo', 'Kanagawa', 'Niigata', 'Toyama', 'Ishikawa', 'Fukui', 'Yamanashi', 'Nagano', 'Gifu', 'Shizuoka',
  'Aichi', 'Mie', 'Shiga', 'Kyoto', 'Osaka', 'Hyogo', 'Nara', 'Wakayama', 'Tottori', 'Shimane', 'Okayama',
  'Hiroshima', 'Yamaguchi', 'Tokushima', 'Kagawa', 'Ehime', 'Kochi', 'Fukuoka', 'Saga', 'Nagasaki', 'Kumamoto',
  'Oita', 'Miyazaki', 'Kagoshima', 'Okinawa',
])

type Row = [label: ZipLabel, pattern: string, example: string, zipFirst: boolean, houseNumber: boolean]
const P = 'postal' as const
// [postcode label, pattern, example, postcode before city, house number expected]
const ROWS: Record<string, Row> = {
  DK: [P, '\\d{4}', '2100', true, true],
  AT: [P, '\\d{4}', '1010', true, true],
  BE: [P, '\\d{4}', '1000', true, true],
  BG: [P, '\\d{4}', '1000', true, false],
  HR: [P, '\\d{5}', '10000', true, true],
  CY: [P, '\\d{4}', '1010', true, false],
  CZ: [P, '\\d{3} ?\\d{2}', '110 00', true, true],
  EE: [P, '\\d{5}', '10111', true, true],
  FI: [P, '\\d{5}', '00100', true, true],
  FR: [P, '\\d{2} ?\\d{3}', '75001', true, false],
  DE: [P, '\\d{5}', '10115', true, true],
  GR: [P, '\\d{3} ?\\d{2}', '105 57', true, false],
  HU: [P, '\\d{4}', '1051', false, true],
  IE: ['eircode', '[\\dA-Z]{3} ?[\\dA-Z]{4}', 'D02 X285', false, false],
  IT: [P, '\\d{5}', '00144', true, false],
  LV: [P, '(?:LV-?)?\\d{4}', 'LV-1010', false, true],
  LT: [P, '(?:LT-?)?\\d{5}', 'LT-01100', true, true],
  LU: [P, '(?:L-?)?\\d{4}', '1111', true, true],
  MT: [P, '[A-Z]{3} ?\\d{2,4}', 'VLT 1117', false, false],
  NL: [P, '\\d{4} ?[A-Z]{2}', '1012 AB', true, true],
  PL: [P, '\\d{2}-?\\d{3}', '00-950', true, true],
  PT: [P, '\\d{4}-?\\d{3}', '1000-001', true, false],
  RO: [P, '\\d{6}', '010011', true, false],
  SK: [P, '\\d{3} ?\\d{2}', '811 01', true, true],
  SI: [P, '(?:SI-?)?\\d{4}', '1000', true, true],
  ES: [P, '\\d{5}', '28001', true, false],
  SE: [P, '\\d{3} ?\\d{2}', '114 55', true, true],
  AU: ['postcode', '\\d{4}', '2000', false, true],
  CA: [P, '[ABCEGHJ-NPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z] ?\\d[ABCEGHJ-NPRSTV-Z]\\d', 'K1A 0B1', false, true],
  IS: [P, '\\d{3}', '101', true, false],
  JP: [P, '\\d{3}-?\\d{4}', '100-0001', true, true],
  NZ: ['postcode', '\\d{4}', '6011', false, true],
  NO: [P, '\\d{4}', '0150', true, true],
  SG: [P, '\\d{6}', '238801', false, true],
  KR: [P, '\\d{5}', '03051', false, true],
  CH: [P, '\\d{4}', '8001', true, true],
  GB: ['postcode', '(?:GIR ?0AA|[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[ABD-HJLNP-UW-Z]{2})', 'SW1A 1AA', false, false],
  US: ['zip', '\\d{5}(?:-\\d{4})?', '10001', false, true],
}

const REGIONS: Record<string, AddressFormat['region']> = {
  US: { label: 'state', options: US_STATES, write: 'code' },
  CA: { label: 'province', options: CA_PROVINCES, write: 'code' },
  AU: { label: 'stateTerritory', options: AU_STATES, write: 'code' },
  IE: { label: 'county', options: IE_COUNTIES, write: 'county' },
  IT: { label: 'province', options: IT_PROVINCES, write: 'code' },
  ES: { label: 'province', options: ES_PROVINCES, write: 'name' },
  JP: { label: 'prefecture', options: JP_PREFECTURES, write: 'name' },
}

const DEFAULT_ROW: Row = [P, '[A-Z\\d][A-Z\\d -]{1,10}', '', true, false]
const cache = new Map<string, AddressFormat>()

/** The format for a country (English name, as the API stores it). Unknown countries get a lenient default. */
export function addressFormat(country: string): AddressFormat {
  const code = COUNTRY_CODES[country] ?? ''
  let f = cache.get(code)
  if (!f) {
    const [label, pattern, example, zipFirst, houseNumber] = ROWS[code] ?? DEFAULT_ROW
    f = {
      code,
      zip: { label, re: new RegExp(`^${pattern}$`), example, required: code !== 'IE', numeric: !/[A-Z-]/.test(pattern) },
      zipFirst,
      region: REGIONS[code],
      houseNumber,
    }
    cache.set(code, f)
  }
  return f
}

/** " d02x285 " → "D02 X285" (upper case, single spaces; the space a format expects is put back). */
export function normalizeZip(country: string, zip: string): string {
  let z = zip.trim().toUpperCase().replace(/\s+/g, ' ')
  const code = COUNTRY_CODES[country]
  // "DK-2100", "SE-114 55": the old country prefix (kept where it is part of the code: LV-, LT-, SI-, L-).
  if (code && !['LV', 'LT', 'SI', 'LU'].includes(code) && z.startsWith(`${code}-`)) z = z.slice(code.length + 1).trim()
  if ((code === 'GB' || code === 'CA') && /^[A-Z\d]{5,7}$/.test(z)) z = `${z.slice(0, -3)} ${z.slice(-3)}`
  if (code === 'IE' && /^[A-Z\d]{7}$/.test(z)) z = `${z.slice(0, 3)} ${z.slice(3)}`
  if (code === 'NL' && /^\d{4}[A-Z]{2}$/.test(z)) z = `${z.slice(0, 4)} ${z.slice(4)}`
  return z
}

export type ZipProblem = 'required' | 'format' | null

export function checkZip(country: string, zip: string): ZipProblem {
  const f = addressFormat(country)
  const z = normalizeZip(country, zip)
  if (!z) return f.zip.required ? 'required' : null
  return f.zip.re.test(z) ? null : 'format'
}

export type StreetProblem = 'required' | 'letters' | 'number' | null

const LETTER = /\p{L}/u
const LETTERS2 = /\p{L}.*\p{L}/u

/** Street line sanity: present, has a street name (two letters or more), and a house number where streets have one. */
export function checkStreet(country: string, line1: string): StreetProblem {
  const s = line1.trim()
  if (!s) return 'required'
  if (!LETTERS2.test(s) && COUNTRY_CODES[country] !== 'JP') return 'letters'
  if (addressFormat(country).houseNumber && !/\d/.test(s)) return 'number'
  return null
}

/** A name or city needs at least one letter ("12" or "--" is not one). */
export const hasLetter = (s: string) => LETTER.test(s)

/** The region code the form sends, matched case-insensitively against codes and names; null when unknown. */
export function findRegion(country: string, value: string): readonly [string, string] | null {
  const r = addressFormat(country).region
  const v = value.trim().toLowerCase().replace(/^co\.?\s+/, '')
  if (!r || !v) return null
  return r.options.find(([c, n]) => c.toLowerCase() === v || n.toLowerCase() === v) ?? null
}

/** Orders and saved addresses have no region column: the region is written after the city ("Austin, TX"),
    which reads right wherever an address is shown ("78701 Austin, TX"). */
export function cityWithRegion(country: string, city: string, region: string): string {
  const r = addressFormat(country).region
  const hit = findRegion(country, region)
  if (!r || !hit) return city.trim()
  const part = r.write === 'code' ? hit[0] : r.write === 'county' ? `Co. ${hit[1]}` : hit[1]
  return `${city.trim()}, ${part}`
}

/** The reverse, for a saved address: "Austin, TX" → { city: "Austin", region: "TX" }. */
export function splitCityRegion(country: string, city: string): { city: string; region: string } {
  const i = city.lastIndexOf(',')
  if (i > 0 && addressFormat(country).region) {
    const hit = findRegion(country, city.slice(i + 1))
    if (hit) return { city: city.slice(0, i).trim(), region: hit[0] }
  }
  return { city, region: '' }
}
