/* Presentation helpers shared by the account screens (Overview, Downloads; WP-14's order history and details).
   Port of VAREL src/pages/account/orderUtils.ts: the colour maps of the prototypes' renderVals(), address and
   item lines, account links. No global i18n: the language and `t` are passed in. */
import type { TFunction } from '@/lib/i18n/core'
import { href, returnsLink, shopLink, wishlistLink } from '@/lib/links'
import type { Address } from '@/lib/types/account'
import type { Order, OrderItem } from '@/lib/types/orders'
import { countryName } from './countries'

/** Payment status → token text class (Order History / Order Details `payColors`). */
export function payTextClass(payment: Order['payment']): string {
  switch (payment) {
    case 'Paid':
      return 'text-signal-positive'
    case 'Refunded':
    case 'Failed':
      return 'text-signal-critical'
    case 'Pending':
      return 'text-signal-notice'
    default:
      return 'text-ink-400'
  }
}

/** Fulfilment status → token text class (`statusColors`). */
export function statusTextClass(fulfillment: Order['fulfillment']): string {
  switch (fulfillment) {
    case 'Shipped':
    case 'Processing':
      return 'text-signal-notice'
    case 'Delivered':
      return 'text-signal-positive'
    case 'Returned':
    case 'Cancelled':
      return 'text-signal-critical'
    default:
      return 'text-ink-400'
  }
}

type AddressLike = Pick<Address, 'name' | 'line1' | 'line2' | 'zip' | 'city' | 'country'>

/** "Mira Halvorsen, 112 Studio, Nørrebro, Apt 4, 2200 Copenhagen, Denmark" (country in `locale`). */
export function addressBlock(a: AddressLike, locale = 'en'): string {
  return [a.name, a.line1, a.line2, `${a.zip} ${a.city}`.trim(), countryName(a.country, locale)].filter(Boolean).join(', ')
}

/** The same address as postal lines, for cards. */
export function addressLines(a: AddressLike, locale = 'en'): string[] {
  return [a.name, a.line1, a.line2, `${a.zip} ${a.city}`.trim(), countryName(a.country, locale)].filter(
    (l): l is string => !!l,
  )
}

/** "Camel · M · Qty 1" (`t` must read the `checkout` namespace: `checkout:qty`). */
export function itemMeta(
  t: TFunction,
  i: Pick<OrderItem, 'color' | 'size' | 'qty'> & { options?: Record<string, string> | null },
): string {
  return [i.color, i.size, ...Object.values(i.options ?? {}), t('checkout:qty', { qty: i.qty })].filter(Boolean).join(' · ')
}

/** Units in an order. */
export function orderUnits(o: Pick<Order, 'items' | 'count'>): number {
  return o.count ?? o.items.reduce((n, i) => n + i.qty, 0)
}

/** In-app paths, relative to the router's basepath (use with `<AppLink to>`). */
export const appPaths = {
  account: '/',
  orders: '/orders/',
  order: '/orders/$number/',
  details: '/details/',
  addresses: '/addresses/',
  downloads: '/downloads/',
  privacy: '/privacy/',
} as const

/** Full hrefs in `locale`: for plain `<a href>` (storefront pages leave the app). */
export function accountLinks(locale: string) {
  return {
    account: href('/account/', locale),
    orders: href('/account/orders/', locale),
    order: (n: string) => href(`/account/orders/${encodeURIComponent(n)}/`, locale),
    returns: (order?: string | null) => returnsLink(order, locale),
    wishlist: wishlistLink(locale),
    shop: shopLink(locale),
    home: href('/', locale),
    contact: href('/contact/', locale),
    terms: href('/terms/', locale),
    /** The sign-in pages are prerendered (English URLs): never prefixed. */
    login: '/account/login/',
    forgot: '/account/forgot/',
  }
}

const isUrl = (file: string) => /^(https?:)?\/\//.test(file) || file.startsWith('/')

/** Download link for a digital file: `/site-api/downloads/<file>` (a 302 to a short-lived private link);
 *  guests add their order number and email. Absolute URLs and `/` paths are used as they are. */
export function downloadHref(file: string, guest?: { order: string; email: string }): string {
  if (isUrl(file)) return file
  const base = `/site-api/downloads/${encodeURIComponent(file)}`
  if (!guest) return base
  return `${base}?${new URLSearchParams({ order: guest.order, email: guest.email }).toString()}`
}

/** Platform file ids (`file_…`) mean nothing to people: lists hide them. */
export const isPlatformFileId = (file: string) => /^file_[0-9a-z]{26}$/.test(file)
