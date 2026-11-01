/* The checkout address model (port of the pure part of VAREL src/pages/checkout/AddressFields.tsx): state, the
   API shape and the client rules. Validation uses the same module as the server (src/server/lib/address-formats.ts,
   pure, no imports), so the browser and the API judge an address the same way. */
import type {Translate} from '@/components/varel/text';
import type {CheckoutAddress} from '@/lib/types/orders';
import {
  addressFormat,
  checkStreet,
  checkZip,
  findRegion,
  hasLetter,
  normalizeZip,
  splitCityRegion,
} from '@/server/lib/address-formats';

export interface AddressState {
  name: string;
  country: string;
  line1: string;
  line2: string;
  city: string;
  /** State / province / county code, for countries whose addresses carry one (US, CA, AU, IE, IT, ES, JP) */
  region: string;
  zip: string;
}

export type AddressErrors = Partial<Record<keyof AddressState, string>>;

export const EMPTY_ADDRESS: AddressState = {name: '', country: '', line1: '', line2: '', city: '', region: '', zip: ''};

/** A saved / API address. A saved `region` is used as is; without one, "Austin, TX" is split back into city and state. */
export function toAddressState(a: {
  name: string;
  country: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  zip: string;
}): AddressState {
  const split = a.region ? {city: a.city, region: a.region} : splitCityRegion(a.country, a.city);
  return {name: a.name, country: a.country, line1: a.line1, line2: a.line2 ?? '', city: split.city, region: split.region, zip: a.zip};
}

/** The address as POST /site-api/checkout takes it (the API writes the region after the city). */
export function toApiAddress(a: AddressState): CheckoutAddress {
  const f = addressFormat(a.country);
  return {
    name: a.name.trim(),
    line1: a.line1.trim(),
    ...(a.line2.trim() ? {line2: a.line2.trim()} : {}),
    city: a.city.trim(),
    ...(f.region ? {region: a.region} : {}),
    zip: normalizeZip(a.country, a.zip),
    country: a.country,
  };
}

/** Same rules as the API (src/server/lib/address-formats.ts), in the shopper's language (`t`: checkout namespace). */
export function validateAddress(a: AddressState, t: Translate): AddressErrors {
  const e: AddressErrors = {};
  const msg = (k: string, vars?: Record<string, string>) => t(`errors.${k}`, vars);
  const f = addressFormat(a.country);
  if (!a.name.trim() || !hasLetter(a.name)) e.name = msg('name');
  if (!a.country) e.country = msg('country');
  const street = checkStreet(a.country, a.line1);
  if (street === 'required') e.line1 = msg('line1');
  else if (street === 'letters') e.line1 = msg('line1Letters');
  else if (street === 'number') e.line1 = msg('line1Number');
  if (!a.city.trim() || !hasLetter(a.city)) e.city = msg('city');
  if (f.region && !findRegion(a.country, a.region)) e.region = msg(`region.${f.region.label}`);
  const zip = checkZip(a.country, a.zip);
  if (zip === 'required') e.zip = msg(`zipRequired.${f.zip.label}`);
  else if (zip === 'format') e.zip = msg('zipFormat', {example: f.zip.example});
  return e;
}
