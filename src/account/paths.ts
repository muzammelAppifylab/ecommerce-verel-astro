/* The /account/* paths the account app serves, after the basepath (no leading slash). The host page
   (src/pages/account/[...path].astro) answers anything else under /account/ with the 404 page. The static
   sign-in pages (login, register, forgot, reset, verify, confirm-email) win over the catch-all route. */
export const ACCOUNT_PATH_RE = /^(|orders\/?|orders\/[^/]{1,40}\/?|details\/?|addresses\/?|downloads\/?|privacy\/?)$/

export const isAccountPath = (sub: string | undefined | null) => ACCOUNT_PATH_RE.test(sub ?? '')
