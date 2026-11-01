import {Field, RadioCards, Select} from '../../ui';
import {SETTINGS_LIMITS as L} from './limits';
import {
  type Errors,
  fieldAria,
  fromPercent,
  isAmount,
  Section,
  type SettingsCodec,
  SettingsShell,
  toPercent,
  ToggleRow,
  useSettingsDraft,
} from './shared';
import {CountryRates} from './tax-rates';

/** Settings · Tax and currency (port of VAREL `TaxSettings.tsx`): currency, gross or net prices, default rate, country rates, what is taxed. */

const CURRENCIES = [
  {value: 'USD', label: 'USD · US dollar'},
  {value: 'EUR', label: 'EUR · Euro'},
  {value: 'GBP', label: 'GBP · Pound sterling'},
  {value: 'DKK', label: 'DKK · Danish krone'},
  {value: 'SEK', label: 'SEK · Swedish krona'},
  {value: 'NOK', label: 'NOK · Norwegian krone'},
  {value: 'CHF', label: 'CHF · Swiss franc'},
  {value: 'CAD', label: 'CAD · Canadian dollar'},
  {value: 'AUD', label: 'AUD · Australian dollar'},
  {value: 'NZD', label: 'NZD · New Zealand dollar'},
  {value: 'JPY', label: 'JPY · Japanese yen'},
  {value: 'PLN', label: 'PLN · Polish złoty'},
];
const OTHER = '__other__';
const isListedCurrency = (c: string) => CURRENCIES.some(x => x.value === c);
const SUPPORTED = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : []);

/** True when the code is an ISO 4217 currency the server accepts (and the browser can format). */
export function validCurrency(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (SUPPORTED.size && !SUPPORTED.has(code)) return false;
  try {
    new Intl.NumberFormat('en', {style: 'currency', currency: code});
    return true;
  } catch {
    return false;
  }
}

/** Formats in the currency being edited (the saved store currency may differ). */
function fmt(n: number, currency: string) {
  const code = validCurrency(currency) ? currency : 'USD';
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(n);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

interface TaxForm {
  currencyChoice: string; // a listed code or OTHER
  currencyOther: string;
  pricesIncludeTax: boolean;
  taxName: string;
  taxPercent: string;
  taxDigital: boolean;
  taxShipping: boolean;
}

const currencyOf = (f: TaxForm) => (f.currencyChoice === OTHER ? f.currencyOther.trim().toUpperCase() : f.currencyChoice);

export const taxCodec: SettingsCodec<TaxForm> = {
  toForm: s => ({
    currencyChoice: isListedCurrency(s.currency) ? s.currency : OTHER,
    currencyOther: isListedCurrency(s.currency) ? '' : s.currency,
    pricesIncludeTax: s.pricesIncludeTax,
    taxName: s.taxName,
    taxPercent: toPercent(s.taxRate),
    taxDigital: s.taxDigital,
    taxShipping: s.taxShipping,
  }),
  toValues: f => ({
    currency: currencyOf(f),
    pricesIncludeTax: f.pricesIncludeTax,
    taxName: f.taxName.trim(),
    taxRate: fromPercent(f.taxPercent),
    taxDigital: f.taxDigital,
    taxShipping: f.taxShipping,
  }),
  validate: f => {
    const e: Errors = {};
    if (!validCurrency(currencyOf(f))) e.currency = 'Use a three-letter ISO 4217 code, e.g. USD, EUR or DKK';
    if (!f.taxName.trim()) e.taxName = 'Enter a tax name';
    else if (f.taxName.trim().length > L.taxName) e.taxName = `Keep a tax name under ${L.taxName} characters`;
    if (!isAmount(f.taxPercent, 100)) e.taxRate = 'Enter a percentage from 0 to 100.';
    return e;
  },
};

export function TaxSettings() {
  const draft = useSettingsDraft(taxCodec);
  const {set, touch, errors, ro} = draft;
  return (
    <SettingsShell title="Tax and currency" description="The store currency, whether prices include tax, and the rates by country." draft={draft}>
      {f => {
        const currency = currencyOf(f);
        const rate = isAmount(f.taxPercent, 100) ? fromPercent(f.taxPercent) : 0;
        const name = f.taxName.trim() || 'Tax';
        return (
          <>
            <Section id="currency" title="Currency" description="One currency for the whole store. Orders keep the currency they were placed in.">
              <div className="grid-2">
                <Field label="Store currency" id="s-currency" error={f.currencyChoice === OTHER ? undefined : errors.currency}>
                  <Select
                    id="s-currency"
                    value={f.currencyChoice}
                    options={[...CURRENCIES, {value: OTHER, label: 'Other…'}]}
                    onChange={e => set({currencyChoice: e.target.value, currencyOther: e.target.value === OTHER ? f.currencyOther : ''})}
                    {...fieldAria('s-currency', f.currencyChoice === OTHER ? undefined : errors.currency)}
                  />
                </Field>
                {f.currencyChoice === OTHER && (
                  <Field label="ISO 4217 code" id="s-currency-other" error={errors.currency} hint="Three letters, e.g. ISK">
                    <input
                      id="s-currency-other"
                      className="settings-mono"
                      maxLength={3}
                      value={f.currencyOther}
                      onChange={e => set({currencyOther: e.target.value.toUpperCase().replace(/[^A-Z]/g, '')})}
                      onBlur={() => touch('currency')}
                      {...fieldAria('s-currency-other', errors.currency)}
                    />
                  </Field>
                )}
              </div>
              <p className="field-hint">
                Prices are stored as numbers and are not converted. Changing the currency relabels every price, so {fmt(148, currency)} is what a 148 product
                shows.
              </p>
            </Section>

            <Section id="display" title="Prices and tax" description="Whether catalogue prices already include tax.">
              <RadioCards
                legend="How prices relate to tax"
                name="prices-include-tax"
                value={f.pricesIncludeTax ? 'gross' : 'net'}
                onChange={v => set({pricesIncludeTax: v === 'gross'})}
                options={[
                  {
                    value: 'gross',
                    title: 'Prices include tax',
                    description: `Customers pay the price shown. ${name} is worked out of it and shown as “incl. ${name}”.`,
                    disabled: ro,
                  },
                  {value: 'net', title: 'Tax is added at checkout', description: `Prices are net. ${name} is added on top at checkout.`, disabled: ro},
                ]}
              />
              <WorkedExample inclusive={f.pricesIncludeTax} rate={rate} name={name} currency={currency} taxShipping={f.taxShipping} />
            </Section>

            <Section id="rate" title="Default rate" description="Used when the shipping country has no rate of its own, and before an address is entered.">
              <div className="grid-2">
                <Field label="Tax name" id="s-taxname" error={errors.taxName} hint="Shown on the bag, checkout and receipts">
                  <input
                    id="s-taxname"
                    value={f.taxName}
                    onChange={e => set({taxName: e.target.value})}
                    onBlur={() => touch('taxName')}
                    {...fieldAria('s-taxname', errors.taxName)}
                  />
                </Field>
                <Field label="Rate (%)" id="s-taxrate" error={errors.taxRate} hint="Entered as a percent, e.g. 25">
                  <input
                    id="s-taxrate"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={0.01}
                    value={f.taxPercent}
                    onChange={e => set({taxPercent: e.target.value})}
                    onBlur={() => touch('taxRate')}
                    {...fieldAria('s-taxrate', errors.taxRate)}
                  />
                </Field>
              </div>
            </Section>

            <Section id="countries" title="Rates by country" description="A country listed here uses its own rate. Changes here save straight away.">
              <CountryRates defaultName={f.taxName.trim() || 'VAT'} />
            </Section>

            <Section id="scope" title="What is taxed">
              <ToggleRow
                label="Tax digital products"
                description="Off excludes digital products, such as patterns and guides, from tax."
                checked={f.taxDigital}
                onChange={taxDigital => set({taxDigital})}
                disabled={ro}
              />
              <ToggleRow
                label="Tax shipping"
                description="Applies the same rate to the shipping charge."
                checked={f.taxShipping}
                onChange={taxShipping => set({taxShipping})}
                disabled={ro}
              />
            </Section>
          </>
        );
      }}
    </SettingsShell>
  );
}

/** What a 100 product with 10 shipping costs at the default rate (VAREL's worked example, verbatim maths). */
export function WorkedExample({
  inclusive,
  rate,
  name,
  currency,
  taxShipping,
}: {
  inclusive: boolean;
  rate: number;
  name: string;
  currency: string;
  taxShipping: boolean;
}) {
  const price = 100;
  const shipping = 10;
  const pct = `${Math.round(rate * 10000) / 100}%`;
  const rows: [string, string][] = [];
  let total: number;
  if (inclusive) {
    const taxGoods = round2(price - price / (1 + rate));
    const taxShip = taxShipping ? round2(shipping - shipping / (1 + rate)) : 0;
    total = price + shipping;
    rows.push(['Product', fmt(price, currency)], ['Shipping', fmt(shipping, currency)]);
    rows.push([`Includes ${name} ${pct}`, fmt(taxGoods + taxShip, currency)]);
  } else {
    const taxGoods = round2(price * rate);
    const taxShip = taxShipping ? round2(shipping * rate) : 0;
    total = price + shipping + taxGoods + taxShip;
    rows.push(['Product', fmt(price, currency)], ['Shipping', fmt(shipping, currency)], [`${name} ${pct}`, fmt(taxGoods + taxShip, currency)]);
  }
  return (
    <div className="settings-example" aria-live="polite">
      <p className="settings-label">Worked example at the default rate</p>
      <p className="field-hint">
        A product listed at {fmt(price, currency)} with {fmt(shipping, currency)} shipping
        {taxShipping ? ', shipping taxed' : ', shipping not taxed'}.
      </p>
      <dl className="settings-example-rows">
        {rows.map(([k, v]) => (
          <div key={k} data-muted={k.startsWith('Includes') ? '' : undefined}>
            <dt>{k}</dt>
            <dd className="settings-num">{v}</dd>
          </div>
        ))}
        <div className="settings-example-total">
          <dt>Customer pays</dt>
          <dd className="settings-num">{fmt(total, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}
