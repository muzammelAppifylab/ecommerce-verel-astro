/* Presentation helpers for the order screens (VAREL src/pages/account/orderUtils.ts, order part). Mirrors the colour
   maps in the prototypes' renderVals(). Exported for WP-13 (overview) through ./index.ts. */
import type {TFunction} from '@/lib/i18n';
import type {Order, OrderItem} from '@/lib/types/orders';

import {countryName} from './_shared/countries';

/** Payment status → token text class (Order History / Order Details `payColors`). */
export function payTextClass(payment: Order['payment']): string {
  switch (payment) {
    case 'Paid':
      return 'text-signal-positive';
    case 'Refunded':
    case 'Failed':
      return 'text-signal-critical';
    case 'Pending':
      return 'text-signal-notice';
    default:
      return 'text-text-secondary';
  }
}

/** Fulfilment status → token text class (`statusColors`). Neutral states use the secondary ink (ink-400 is under
    4.5:1 on white). */
export function statusTextClass(fulfillment: Order['fulfillment']): string {
  switch (fulfillment) {
    case 'Shipped':
    case 'Processing':
      return 'text-signal-notice';
    case 'Delivered':
      return 'text-signal-positive';
    case 'Returned':
    case 'Cancelled':
      return 'text-signal-critical';
    default:
      return 'text-text-secondary';
  }
}

type AddressLike = {name: string; line1: string; line2?: string | null; zip: string; city: string; country: string};

/** "Mira Halvorsen, 112 Studio, Nørrebro, Apt 4, 2200 Copenhagen, Denmark" */
export function addressBlock(a: AddressLike, locale: string): string {
  return [a.name, a.line1, a.line2, `${a.zip} ${a.city}`.trim(), countryName(a.country, locale)].filter(Boolean).join(', ');
}

/** "Camel · M · Qty 1" */
export function itemMeta(
  t: TFunction,
  i: Pick<OrderItem, 'color' | 'size' | 'qty'> & {options?: Record<string, string>}
): string {
  return [i.color, i.size, ...Object.values(i.options ?? {}), t('checkout:qty', {qty: i.qty})].filter(Boolean).join(' · ');
}

/** Units in an order. */
export function orderUnits(o: Pick<Order, 'items' | 'count'>): number {
  return o.count ?? o.items.reduce((n, i) => n + i.qty, 0);
}

/** Download link for a digital file: absolute URLs and paths as they are, bare names through the downloads route
    (WP-13: 302 to a short-lived private link). */
export function downloadHref(file: string): string {
  if (/^(https?:)?\/\//.test(file) || file.startsWith('/')) return file;
  return `/site-api/downloads/${encodeURIComponent(file)}`;
}

/** Only `https:` links leave the site (tracking pages). */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Tax rate as a percentage with up to two decimals (orders without a snapshot: 25 %). */
export const taxPercent = (rate: number | null | undefined) => Math.round((rate ?? 0.25) * 10_000) / 100;
