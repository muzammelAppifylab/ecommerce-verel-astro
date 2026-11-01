/* Shopify-style address block that follows the country (port of VAREL src/pages/checkout/AddressFields.tsx).
   The model and rules live in ./address (pure, unit-tested); this file is the form. */
import {useEffect, useRef} from 'react';

import {Input, Select} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {addressFormat, findRegion, normalizeZip} from '@/server/lib/address-formats';
import {cn} from '@/lib/utils';

import type {AddressErrors, AddressState} from './address';
import {countryOptions} from './countries';

export {EMPTY_ADDRESS, toAddressState, toApiAddress, validateAddress, type AddressErrors, type AddressState} from './address';

export interface AddressFieldsProps {
  value: AddressState;
  onChange: (patch: Partial<AddressState>) => void;
  countries: string[];
  errors?: AddressErrors;
  /** autocomplete section, e.g. "shipping" | "billing" */
  section: 'shipping' | 'billing';
}

/** Country first, then name, street, apartment, and the postcode / city / state row in the order and with the
 *  labels that country uses. */
export function AddressFields({value, onChange, countries, errors = {}, section}: AddressFieldsProps) {
  const t = useText('checkout');
  const locale = useLocale();
  const ac = (v: string) => `section-${section} ${section} ${v}`;
  const f = addressFormat(value.country);

  // Denmark: a complete postcode fills in the town (when the city is empty or was filled in by us). Fails silently.
  const autoCity = useRef('');
  const {country, zip, city} = value;
  useEffect(() => {
    if (f.code !== 'DK' || !/^\d{4}$/.test(zip.trim())) return;
    if (city.trim() && city !== autoCity.current) return;
    let live = true;
    import('./dkPostcodes')
      .then(({dkTown}) => {
        const town = dkTown(zip);
        if (live && town && town !== city) {
          autoCity.current = town;
          onChange({city: town});
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // onChange is a new function every render; the postcode and country are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.code, country, zip]);

  const zipLabel = t(`address.zipLabel.${f.zip.label}`);
  const zipField = (
    <Input
      key="zip"
      label={f.zip.required ? zipLabel : t('address.optional', {label: zipLabel})}
      value={value.zip}
      onChange={e => onChange({zip: e.target.value})}
      onBlur={() => {
        const z = normalizeZip(value.country, value.zip);
        if (z !== value.zip) onChange({zip: z});
      }}
      error={errors.zip}
      autoComplete={ac('postal-code')}
      inputMode={f.zip.numeric ? 'numeric' : 'text'}
      autoCapitalize="characters"
      spellCheck={false}
      name={`${section}-zip`}
    />
  );
  const cityField = (
    <Input
      key="city"
      label={t('address.city')}
      value={value.city}
      onChange={e => {
        autoCity.current = '';
        onChange({city: e.target.value});
      }}
      error={errors.city}
      autoComplete={ac('address-level2')}
      name={`${section}-city`}
    />
  );
  const regionField = f.region && (
    <Select
      key="region"
      label={t(`address.region.${f.region.label}`)}
      value={value.region}
      placeholder={t('address.choose')}
      options={f.region.options.map(([code, name]) => ({value: code, label: name}))}
      onChange={e => onChange({region: e.target.value})}
      error={errors.region}
      autoComplete={ac('address-level1')}
      name={`${section}-region`}
    />
  );
  // "2100 København Ø" / "Milano, MI 20121"-style rows (Google address metadata order).
  const row = f.zipFirst ? [zipField, cityField, regionField] : [cityField, regionField, zipField];

  return (
    <div className="grid grid-cols-1 gap-6">
      <Select
        label={t('address.country')}
        value={value.country}
        options={countryOptions(countries, locale)}
        placeholder={countries.length ? undefined : t('address.loadingCountries')}
        onChange={e => {
          // A state from another country means nothing here; the postcode is checked again on submit.
          const next = e.target.value;
          onChange(addressFormat(next).region && findRegion(next, value.region) ? {country: next} : {country: next, region: ''});
        }}
        error={errors.country}
        autoComplete={ac('country-name')}
        name={`${section}-country`}
      />
      <Input
        label={t('address.fullName')}
        value={value.name}
        onChange={e => onChange({name: e.target.value})}
        error={errors.name}
        autoComplete={ac('name')}
        name={`${section}-name`}
      />
      <Input
        label={t('address.line1')}
        value={value.line1}
        onChange={e => onChange({line1: e.target.value})}
        error={errors.line1}
        autoComplete={ac('address-line1')}
        name={`${section}-line1`}
      />
      <Input
        label={t('address.line2')}
        value={value.line2}
        onChange={e => onChange({line2: e.target.value})}
        error={errors.line2}
        autoComplete={ac('address-line2')}
        name={`${section}-line2`}
      />
      <div className={cn('grid gap-6', regionField ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')}>{row}</div>
    </div>
  );
}
