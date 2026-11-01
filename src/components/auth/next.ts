/* Where to go after signing in (port of VAREL `src/pages/auth/next.ts` `safeNext`).
   The template's `nextPath()` rules (same-site path, ≤ 512 characters, no `//`, `/\` or control characters)
   plus VAREL's: never back to a sign-in page. The fallback is the customer account, `/account/`.
   PURE except `authNext()` (reads `location.search`). */

export const AUTH_FALLBACK = '/account/'

/** `/account/login/`, `/da/account/register/?next=…`, `/account/reset` … (with or without a locale prefix). */
const SIGN_IN_PAGE = /^\/(?:[a-z]{2}\/)?account\/(?:login|register|forgot|reset|verify|confirm-email)(?:[/?#]|$)/i

/** A `?next=` value made safe: a same-site path that is not a sign-in page, else the fallback. */
export function safeAuthNext(value: string | null | undefined, fallback = AUTH_FALLBACK): string {
  if (!value || value.length > 512) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback
  if (SIGN_IN_PAGE.test(value)) return fallback
  return value
}

/** BROWSER: this page's `?next=`, made safe. */
export function authNext(search: string = window.location.search): string {
  return safeAuthNext(new URLSearchParams(search).get('next'))
}

/** `path?next=…` when `next` is not the fallback (VAREL: `next !== '/account'`). */
export function withNext(path: string, next: string): string {
  return next === AUTH_FALLBACK ? path : `${path}?next=${encodeURIComponent(next)}`
}
