/*
 * Words for the bag islands (WP-09). Components read them through F2's <TextProvider> (src/components/varel/text):
 * the cart page passes `cart`, `checkout`, `product`, `layout` and `common`; the bag drawer lives in the header
 * island, whose provider carries `layout` and `common` only. For the keys a provider lacks (the drawer's
 * `checkout` rows, the pending labels below), `useCartText(ns)` falls back to this English copy (VAREL
 * src/locales/en/{checkout,cart}.json), so nothing ever reads as a raw key.
 */
import {useMemo} from 'react';

import {translate, useLocale, useText, type Dict, type Dicts, type TextVars, type Translate} from '@/components/varel/text';

/** English source of the keys the bag islands read outside the header's catalogs. */
export const CART_TEXT_EN: Dicts = {
  checkout: {
    discount: {
      label: 'Discount code',
      apply: 'Apply',
      enter: 'Enter a discount code',
      applied: '{{code}} applied.',
      appliedReplaces: '{{code}} applied. It replaces {{previous}}.',
      saved: '{{code}} saved to your bag.',
      savedReplaces: '{{code}} saved to your bag. It replaces {{previous}}.',
      statusApplied: '{{code}} applied',
      statusSaved: '{{code}} saved · not applied yet',
      fallback: 'Discount',
      remove: 'Remove',
      removeAria: 'Remove code {{code}}',
      lineFree_one: '{{count}} free · {{amount}}',
      lineFree_other: '{{count}} free · {{amount}}',
      toggle: 'Have a discount code?',
    },
    totals: {
      subtotal: 'Subtotal',
      shipping: 'Shipping',
      shippingWith: 'Shipping · {{method}}',
      taxRate: '{{name}} ({{rate}}%)',
      includes: 'Includes {{tax}}',
      total: 'Total',
      freeWith: 'Free · {{name}}',
      was: 'Was ',
      now: 'Now ',
      youSave: 'You save {{amount}}',
    },
    qty: 'Qty {{qty}}',
    removeCode: 'Remove code',
  },
  cart: {
    applying: 'Applying…',
    removing: 'Removing…',
    loading: 'Loading…',
    bagFull: 'Your bag is full. Remove a piece to add another.',
  },
  product: {
    stock: {
      inStock: 'In stock',
      lowLeft_one: 'Only {{count}} left',
      lowLeft_other: 'Only {{count}} left',
      backorder: 'Made to order · ships in 2–3 weeks',
      digitalNoShipping: 'Digital · no shipping',
    },
  },
};

/** `useText(ns)` with this module's English copy behind it (for keys the surrounding provider lacks). */
export function useCartText(ns: string): Translate {
  const t = useText(ns);
  const locale = useLocale();
  return useMemo<Translate>(
    () => (key, vars) => {
      const s = t(key, vars);
      return s === key ? translate(CART_TEXT_EN, locale, ns, key, vars) : s;
    },
    [t, locale, ns]
  );
}

/** A plain English translator for one namespace (defaults of the helpers that take a `t`). */
export const englishText =
  (ns: string): Translate =>
  (key: string, vars?: TextVars) =>
    translate(CART_TEXT_EN, 'en', ns, key, vars);

/** F4's helpers (`lineStock`) take a `TFunction`; F2's `Translate` is the same call with narrower vars. */
export const asTFunction =
  (t: Translate) =>
  (key: string, vars?: Record<string, unknown>): string =>
    t(key, vars as TextVars);

export type {Dict, Dicts, Translate};
