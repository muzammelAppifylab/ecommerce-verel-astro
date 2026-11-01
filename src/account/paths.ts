/* The /account/* paths the account app serves, after the basepath (no leading slash). The host page
   (src/pages/account/[...path].astro) answers anything else under /account/ with the 404 page. The static
   sign-in pages (login, register, forgot, reset, verify, confirm-email) win over the catch-all route. */
export const ACCOUNT_PATH_RE = /^(|orders\/?|orders\/[^/]{1,40}\/?|details\/?|addresses\/?|downloads\/?|privacy\/?)$/

export const isAccountPath = (sub: string | undefined | null) => ACCOUNT_PATH_RE.test(sub ?? '')

export type Section = 'overview' | 'orders' | 'wishlist' | 'details' | 'addresses' | 'downloads' | 'privacy'

/** Sections that are screens of the app (the wishlist is a storefront page). */
const IN_APP: readonly Section[] = ['overview', 'orders', 'details', 'addresses', 'downloads', 'privacy']

/** The section a path inside the app belongs to ("/orders/VRL-1/" → orders). `path` is relative to the basepath. */
export function sectionOf(path: string): Section {
  const seg = path.replace(/^\/+/, '').split('/')[0] as Section | undefined
  return seg && IN_APP.includes(seg) ? seg : 'overview'
}

/** The pathname without the router's basepath ("/da/account/orders/" → "/orders/"). */
export function inAppPath(pathname: string, basepath: string): string {
  const rest = pathname.startsWith(basepath) ? pathname.slice(basepath.length) : pathname
  return rest.startsWith('/') ? rest : `/${rest}`
}
