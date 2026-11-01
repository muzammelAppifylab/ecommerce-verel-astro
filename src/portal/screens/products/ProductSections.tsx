/* Product editor panels in the main column, Shopify order (VAREL `ProductSections.tsx`): Pricing (with cost, profit
   and margin), Inventory (base SKU, stock for a product without options, selling past zero) and Shipping (physical
   toggle, weight, packed size; digital products get their download file here instead).
   `Panel` → kit `Card`, `MoneyInput` → kit `MoneyInput` (store currency symbol), `Switch` → kit `Switch`,
   `NativeSelect` → kit `Select`. */
import {money} from '../../../lib/format';
import type {DimensionUnit, WeightUnit} from '../../../lib/types/admin/catalog';
import {Button, Card, cleanAmount, Field, MoneyInput, Select, Switch} from '../../ui';
import {type FieldErrors, type ProductForm, profitOf, type VariantItem} from './form';

export type SetField = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => void;

/** `aria-invalid` + `aria-describedby` for a control inside a kit `Field` (its `<id>-error` / `<id>-hint`). */
export function aria(id: string, error: string | undefined, hint?: unknown) {
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

/* ---------- Pricing ---------- */

export function PricingPanel({
  form,
  set,
  errors,
  symbol,
  disabled,
  onApplyToVariants,
  onBlur,
}: {
  form: ProductForm;
  set: SetField;
  errors: FieldErrors;
  symbol: string;
  disabled?: boolean;
  onApplyToVariants: () => void;
  onBlur: (path: string) => void;
}) {
  const p = profitOf(form.price, form.costPerItem);
  // Variants with their own price; the rest follow this one.
  const own = form.type === 'physical' ? form.variants.filter(v => v.price.trim() !== '').length : 0;
  const priceHint = form.variants.length > 1 ? 'Every variant uses this price unless you set its own.' : undefined;
  return (
    <Card title="Pricing">
      <div className="grid-2 editor-fields">
        <Field id="p-price" label="Price" error={errors.price} hint={priceHint}>
          <MoneyInput
            id="p-price"
            symbol={symbol}
            value={form.price}
            disabled={disabled}
            onChange={e => set('price', e.target.value)}
            onBlur={() => onBlur('price')}
            {...aria('p-price', errors.price, priceHint)}
          />
        </Field>
        <Field id="p-compare" label="Compare-at price" error={errors.compareAt} hint="The higher, struck-through price for a sale.">
          <MoneyInput
            id="p-compare"
            symbol={symbol}
            value={form.compareAt}
            disabled={disabled}
            onChange={e => set('compareAt', e.target.value)}
            onBlur={() => onBlur('compareAt')}
            {...aria('p-compare', errors.compareAt, true)}
          />
        </Field>
      </div>
      {own > 0 && (
        <p className="editor-note editor-note-action">
          {own === form.variants.length ? 'Every variant has its own price.' : `${own} of ${form.variants.length} variants have their own price.`}
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onApplyToVariants}>
            Use {form.price ? money(Number(form.price)) : 'this price'} for every variant
          </Button>
        </p>
      )}
      <div className="grid-3 editor-fields editor-divided">
        <Field id="p-cost" label="Cost per item" error={errors.costPerItem} hint="Customers never see this.">
          <MoneyInput
            id="p-cost"
            symbol={symbol}
            value={form.costPerItem}
            disabled={disabled}
            onChange={e => set('costPerItem', e.target.value)}
            onBlur={() => onBlur('costPerItem')}
            {...aria('p-cost', errors.costPerItem, true)}
          />
        </Field>
        <Readout label="Profit" value={p ? money(Math.round(p.profit * 100) / 100) : '—'} bad={Boolean(p && p.profit < 0)} />
        <Readout label="Margin" value={p ? `${p.margin.toFixed(1)}%` : '—'} bad={Boolean(p && p.margin < 0)} />
      </div>
    </Card>
  );
}

function Readout({label, value, bad}: {label: string; value: string; bad?: boolean}) {
  return (
    <div className="readout">
      <span className="readout-label">{label}</span>
      <span className="readout-value" data-tone={bad ? 'bad' : undefined}>
        {value}
      </span>
    </div>
  );
}

/* ---------- Inventory ---------- */

/** The lone variant of a physical product without options (its stock is edited here), or null. */
export function singleVariant(form: ProductForm): VariantItem | null {
  const v = form.variants[0];
  return form.type !== 'digital' && form.variants.length === 1 && v && !v.color && !v.size && !Object.keys(v.options ?? {}).length ? v : null;
}

export function InventoryPanel({
  form,
  set,
  errors,
  disabled,
  onSkuChange,
  onBlur,
}: {
  form: ProductForm;
  set: SetField;
  errors: FieldErrors;
  disabled?: boolean;
  onSkuChange: (sku: string) => void;
  onBlur: (path: string) => void;
}) {
  const digital = form.type === 'digital';
  const single = singleVariant(form);
  const patchSingle = (p: Partial<VariantItem>) =>
    set(
      'variants',
      form.variants.map((v, i) => (i === 0 ? {...v, ...p} : v))
    );
  const skuHint = single || digital ? 'Stock keeping unit.' : 'Variant SKUs are built from it unless you set them.';
  const qtyError = errors['variants.0.inventory'];
  return (
    <Card title="Inventory">
      <div className="grid-2 editor-fields">
        <Field id="p-sku" label={single || digital ? 'SKU' : 'Base SKU'} error={errors.sku} hint={skuHint}>
          <input
            id="p-sku"
            className="mono"
            value={form.sku}
            disabled={disabled}
            maxLength={64}
            autoComplete="off"
            onChange={e => onSkuChange(e.target.value.toUpperCase())}
            onBlur={() => onBlur('sku')}
            {...aria('p-sku', errors.sku, skuHint)}
          />
        </Field>
        {single && (
          <Field id="p-qty" label="Available" error={qtyError} hint="Units you can sell now.">
            <input
              id="p-qty"
              className="tabular"
              inputMode="numeric"
              autoComplete="off"
              value={single.inventory}
              disabled={disabled}
              onChange={e => patchSingle({inventory: e.target.value.replace(/[^\d]/g, '')})}
              onFocus={e => e.target.select()}
              onBlur={() => onBlur('variants.0.inventory')}
              {...aria('p-qty', qtyError, true)}
            />
          </Field>
        )}
      </div>
      {!single && !digital && <p className="editor-note">Stock is set per variant in the Variants table below.</p>}
      <div className="editor-divided">
        <Switch
          label="Sell when out of stock"
          description={
            digital
              ? 'Digital products never run out.'
              : form.allowBackorder
                ? 'Made to order once stock runs out. The product page reads “Made to order · ships in 2–3 weeks”.'
                : single
                  ? 'Shows as sold out when stock reaches zero.'
                  : 'Variants with no stock show as sold out.'
          }
          checked={!digital && form.allowBackorder}
          onChange={v => set('allowBackorder', v)}
          disabled={digital || disabled}
        />
      </div>
    </Card>
  );
}

/* ---------- Shipping ---------- */

const WEIGHT_UNITS: WeightUnit[] = ['kg', 'g', 'lb', 'oz'];
const DIMENSION_UNITS: DimensionUnit[] = ['cm', 'in'];

function Measure({
  id,
  prefix,
  value,
  error,
  label,
  disabled,
  describedBy,
  onChange,
  onBlur,
}: {
  id: string;
  prefix?: string;
  value: string;
  error?: string;
  label: string;
  disabled?: boolean;
  describedBy?: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <span className="measure" data-prefix={prefix ? '' : undefined}>
      {prefix && (
        <span className="measure-prefix" aria-hidden="true">
          {prefix}
        </span>
      )}
      <input
        id={id}
        className="tabular"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder="0.0"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={e => onChange(cleanAmount(e.target.value))}
        onBlur={onBlur}
      />
    </span>
  );
}

export function ShippingPanel({
  form,
  set,
  errors,
  typeLocked,
  disabled,
  onBlur,
}: {
  form: ProductForm;
  set: SetField;
  errors: FieldErrors;
  /** The type cannot change once the product is in orders */
  typeLocked?: boolean;
  disabled?: boolean;
  onBlur: (path: string) => void;
}) {
  const physical = form.type === 'physical';
  const sizeError = errors.packageLength ?? errors.packageWidth ?? errors.packageHeight;
  const sizeDescribed = sizeError ? 'p-length-error' : 'p-length-hint';
  return (
    <Card title="Shipping">
      <Switch
        label="Physical product"
        description={
          typeLocked
            ? `This product is in orders, so it stays ${physical ? 'physical.' : 'digital.'}`
            : physical
              ? 'Shipped to the customer. Turn off for a digital download.'
              : 'Delivered as a download after payment. No stock or shipping.'
        }
        checked={physical}
        onChange={on => set('type', on ? 'physical' : 'digital')}
        disabled={typeLocked || disabled}
      />

      {physical ? (
        <div className="editor-fields editor-divided">
          <Field id="p-weight" label="Weight" error={errors.weight} hint="Packed weight, for carriers and future weight-based rates.">
            <span className="measure-row">
              <Measure
                id="p-weight"
                value={form.weight}
                error={errors.weight}
                label="Weight"
                disabled={disabled}
                describedBy={errors.weight ? 'p-weight-error' : 'p-weight-hint'}
                onChange={v => set('weight', v)}
                onBlur={() => onBlur('weight')}
              />
              <span className="unit-select">
                <Select
                  aria-label="Weight unit"
                  value={form.weightUnit}
                  disabled={disabled}
                  options={WEIGHT_UNITS.map(u => ({value: u, label: u}))}
                  onChange={e => set('weightUnit', e.target.value as WeightUnit)}
                />
              </span>
            </span>
          </Field>
          <Field id="p-length" label="Packed size" error={sizeError} hint="Length × width × height of the parcel when shipped alone.">
            <span className="measure-row">
              <Measure
                id="p-length"
                prefix="L"
                value={form.packageLength}
                error={errors.packageLength}
                label="Length"
                disabled={disabled}
                describedBy={sizeDescribed}
                onChange={v => set('packageLength', v)}
                onBlur={() => onBlur('packageLength')}
              />
              <span className="muted" aria-hidden="true">
                ×
              </span>
              <Measure
                id="p-width"
                prefix="W"
                value={form.packageWidth}
                error={errors.packageWidth}
                label="Width"
                disabled={disabled}
                describedBy={sizeDescribed}
                onChange={v => set('packageWidth', v)}
                onBlur={() => onBlur('packageWidth')}
              />
              <span className="muted" aria-hidden="true">
                ×
              </span>
              <Measure
                id="p-height"
                prefix="H"
                value={form.packageHeight}
                error={errors.packageHeight}
                label="Height"
                disabled={disabled}
                describedBy={sizeDescribed}
                onChange={v => set('packageHeight', v)}
                onBlur={() => onBlur('packageHeight')}
              />
              <span className="unit-select">
                <Select
                  aria-label="Size unit"
                  value={form.dimensionUnit}
                  disabled={disabled}
                  options={DIMENSION_UNITS.map(u => ({value: u, label: u}))}
                  onChange={e => set('dimensionUnit', e.target.value as DimensionUnit)}
                />
              </span>
            </span>
          </Field>
        </div>
      ) : (
        <div className="editor-divided">
          <Field id="p-download" label="Download file" error={errors.download} hint="File name delivered after purchase, e.g. varel-pattern-01.pdf">
            <input
              id="p-download"
              value={form.download}
              disabled={disabled}
              maxLength={200}
              autoComplete="off"
              onChange={e => set('download', e.target.value)}
              onBlur={() => onBlur('download')}
              {...aria('p-download', errors.download, true)}
            />
          </Field>
        </div>
      )}
    </Card>
  );
}
