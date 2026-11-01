/* The catalogs the account app reads (src/locales/<locale>/<ns>.json), handed to the island by its host page
   (src/pages/account/[...path].astro → `dictionary(locale, ACCOUNT_NAMESPACES)`).
   account: every screen · orders: order numbers, stages, statuses (and WP-14's order screens) · returns: WP-14's
   order screens · checkout: `qty` · common, layout: the storefront kit (Dialog's close, Breadcrumb's label). */
export const ACCOUNT_NAMESPACES = ['account', 'orders', 'returns', 'checkout', 'common', 'layout'] as const
