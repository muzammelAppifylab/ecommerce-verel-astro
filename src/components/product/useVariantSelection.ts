/* Colour + size + custom options → variant resolution for the PDP (port of VAREL
   src/pages/product/useVariantSelection.ts, prototype renderVals()).
   The selected colour/size live in the URL (?color=&size=) so a selection is shareable: the page reads them on the
   server (`initial`), and a pick writes them back with history.replaceState (no history entry, no scroll; the
   ClientRouter's history.state is kept). Custom options (Fabric, Length…) are held in component state.
   The derivation is a pure function (`deriveSelection`) so it can be unit-tested. */
import {useCallback, useMemo, useState} from 'react';

import {variantOf} from '@/lib/product';
import type {Product, Variant} from '@/lib/types/catalog';

export type StockTone = 'digital' | 'out' | 'low' | 'in';

/** Translator for the `product` namespace (useText('product') in the island). */
export type ProductT = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/** A custom option on the PDP: its values, the chosen one, and the values with nothing left for this selection. */
export interface CustomChoice {
  name: string;
  values: string[];
  value: string;
  soldOut: string[];
}

export interface SelectionState {
  custom: CustomChoice[];
  colors: string[];
  color: string | null;
  sizes: string[];
  size: string | null;
  soldOutSizes: string[];
  variant: Variant | undefined;
  inventory: number | null;
  digital: boolean;
  soldOut: boolean;
  /** Upper bound for the quantity stepper */
  qtyMax: number;
  stockLine: string;
  stockTone: StockTone;
}

export interface VariantSelection extends SelectionState {
  setOption: (name: string, value: string) => void;
  setColor: (c: string) => void;
  setSize: (s: string) => void;
}

/** The colour / size the URL asked for (unknown values fall back, as VAREL did). */
export interface SelectionSearch {
  color?: string | null;
  size?: string | null;
}

type SelectionProduct = Pick<Product, 'swatches' | 'allowBackorder' | 'options' | 'variants' | 'sizes' | 'type'>;

const inStock = (v: Variant | undefined) => !!v && v.inventory !== null && v.inventory > 0;

/** VAREL's derivation, unchanged. A null inventory on a physical variant counts as sold out (only > 0 is stock). */
export function deriveSelection(
  p: SelectionProduct,
  search: SelectionSearch,
  picked: Record<string, string>,
  t: ProductT
): SelectionState {
  const colorParam = search.color ?? undefined;
  const sizeParam = search.size ?? undefined;
  const colors = p.swatches.map(w => w.name);
  const color = colorParam && colors.includes(colorParam) ? colorParam : (colors[0] ?? null);
  const backorder = !!p.allowBackorder; // made to order: every size stays available
  // Custom options: the shopper's pick, else the first value that has a variant with this colour.
  const chosen: Record<string, string> = {};
  for (const o of p.options ?? []) {
    const ok = (val: string) => !!variantOf(p, color, null, {...chosen, [o.name]: val});
    chosen[o.name] = picked[o.name] && o.values.includes(picked[o.name]) ? picked[o.name] : (o.values.find(ok) ?? o.values[0]);
  }
  const custom: CustomChoice[] = (p.options ?? []).map(o => ({
    name: o.name,
    values: o.values,
    value: chosen[o.name],
    soldOut: backorder
      ? []
      : // a value is sold out when no variant in this colour with that value has stock
        o.values.filter(
          val => !p.variants.some(v => (color == null || v.color === color) && (v.options ?? {})[o.name] === val && inStock(v))
        ),
  }));
  const sizes = p.sizes.filter(z => !!variantOf(p, color, z, chosen) || !p.options?.length);
  const soldOutSizes = backorder ? [] : sizes.filter(z => !inStock(variantOf(p, color, z, chosen)));
  const firstAvail = sizes.find(z => !soldOutSizes.includes(z));
  const size = sizes.length ? (sizeParam && sizes.includes(sizeParam) ? sizeParam : (firstAvail ?? sizes[0])) : null;
  const variant = variantOf(p, color, size, chosen) ?? variantOf(p, color, size) ?? p.variants[0];
  const inventory = variant ? variant.inventory : null;
  const digital = p.type === 'digital';
  const madeToOrder = backorder && !digital && !(inventory !== null && inventory > 0);
  const soldOut = !digital && !madeToOrder && !(inventory !== null && inventory > 0);
  // The PDP's low-stock line uses a fixed 3 (Setting.lowStockThreshold drives the product-level `stock` only).
  const stockTone: StockTone = digital
    ? 'digital'
    : soldOut
      ? 'out'
      : madeToOrder
        ? 'in'
        : inventory !== null && inventory <= 3
          ? 'low'
          : 'in';
  const stockLine =
    stockTone === 'digital'
      ? t('stock.instantDownload')
      : madeToOrder
        ? t('stock.backorder')
        : stockTone === 'out'
          ? t('stock.soldOutSize')
          : stockTone === 'low'
            ? t('stock.lowLeft', {count: inventory ?? 0})
            : t('stock.inStock');
  return {
    custom,
    colors,
    color,
    sizes,
    size,
    soldOutSizes,
    variant,
    inventory,
    digital,
    soldOut,
    qtyMax: madeToOrder || backorder ? 9 : Math.max(1, inventory ?? 9),
    stockLine,
    stockTone,
  };
}

/** `?color=&size=` written into the current URL without a history entry (keeps the ClientRouter's state). */
export function writeSearch(patch: SelectionSearch): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState({...(window.history.state ?? {})}, '', url);
}

export function useVariantSelection(p: SelectionProduct, initial: SelectionSearch, t: ProductT): VariantSelection {
  const [search, setSearch] = useState<SelectionSearch>(() => ({color: initial.color ?? null, size: initial.size ?? null}));
  const [picked, setPicked] = useState<Record<string, string>>({});

  const derived = useMemo(() => deriveSelection(p, search, picked, t), [p, search, picked, t]);

  // VAREL navigates only on a pick: an invalid ?color= stays in the URL until the shopper chooses.
  const update = useCallback((patch: SelectionSearch) => {
    setSearch(prev => ({...prev, ...patch}));
    writeSearch(patch);
  }, []);

  const setColor = useCallback(
    (c: string) => update(derived.size ? {color: c, size: derived.size} : {color: c}),
    [update, derived.size]
  );
  const setSize = useCallback(
    (s: string) => update(derived.color ? {color: derived.color, size: s} : {size: s}),
    [update, derived.color]
  );
  const setOption = useCallback((name: string, value: string) => setPicked(prev => ({...prev, [name]: value})), []);

  return {...derived, setColor, setSize, setOption};
}
