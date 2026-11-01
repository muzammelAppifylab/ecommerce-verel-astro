/* Shared browser code of the `/account/*` sign-in pages (WP-15; VAREL `src/pages/auth/ui.tsx`).
   The pages keep the template's flows (`bindForm`, `postJson`, `takeToken`, `signedIn`); this adds the
   page's language, VAREL's rules and the onboarding call after a sign-in. */
import type { SubmitResult } from '../../lib/form'
import { type Dictionary, makeT, type TFunction } from '../../lib/i18n/core'
import { type Rule, rules } from '../../lib/rules'
import { siteFetch } from '../../platform/browser'
import { withNext } from './next'
import { clearStash, readStash } from './stash'

/** The page's `auth` strings, rendered by the server into `#auth-copy[data-copy]` (CSP-safe: no inline script). */
export function readCopy(): TFunction {
  let dict: Dictionary = { locale: 'en', catalogs: {} }
  try {
    const raw = document.getElementById('auth-copy')?.dataset.copy
    if (raw) dict = JSON.parse(raw) as Dictionary
  } catch {
    /* keep the empty dictionary: keys show, the page still works */
  }
  return makeT(dict, 'auth')
}

/** The sign-in forms' rules in the page's language (the template's `AUTH_RULES`, same limits). */
export function authRules(t: TFunction) {
  const email: Rule[] = [rules.required(t('emailRequired')), rules.email(t('emailInvalid')), rules.maxLength(254, t('emailInvalid'))]
  return {
    email,
    password: [rules.required(t('passwordRequired'))] as Rule[],
  }
}

/** Sign-in and sign-up links keep `?next=` (VAREL: only when it is not the account fallback). */
export function keepNext(next: string, root: ParentNode = document): void {
  root.querySelectorAll<HTMLAnchorElement>('a[data-keep-next]').forEach((a) => {
    a.href = withNext(a.pathname, next)
  })
}

/** Pull a token out of a pasted reset link, or accept the bare token (VAREL `tokenFrom`). */
export function tokenFrom(value: string): string {
  const v = value.trim()
  try {
    const token = new URL(v).searchParams.get('token')
    if (token) return token
  } catch {
    /* not a URL */
  }
  const m = v.match(/[?&]token=([^&\s#]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1]!)
    } catch {
      return m[1]!
    }
  }
  return v
}

/** A template reset / verify token: 43 base64url characters. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

const ONBOARDING_TIMEOUT_MS = 3000

/**
 * After ANY successful sign-in: hand the sign-up extras kept in this browser (if typed for this email)
 * to `POST /site-api/account/onboarding` (profile, newsletter, guest bag merge, welcome email), then go
 * on. Never blocks the sign-in: errors are ignored and the call gives up after 3 seconds.
 */
export async function finishSignIn(next: string, email: string, serverNext?: unknown): Promise<SubmitResult> {
  const stash = email ? readStash(email) : null
  const body = stash
    ? { email: stash.email, firstName: stash.firstName, lastName: stash.lastName, newsletter: stash.newsletter }
    : {}
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ONBOARDING_TIMEOUT_MS)
  try {
    const res = await siteFetch('/site-api/account/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (res.ok && stash) clearStash()
  } catch {
    /* onboarding runs again at the next sign-in */
  } finally {
    window.clearTimeout(timer)
  }
  return { ok: true, redirect: typeof serverNext === 'string' && serverNext ? serverNext : next }
}

/** A success that replaces a form: VAREL's positive status box, focused, with an optional solid button. */
export function replaceWithStatus(target: HTMLElement, message: string, link?: { href: string; text: string }): HTMLElement {
  const box = document.createElement('div')
  box.className = 'auth-status'
  box.setAttribute('role', 'status')
  const p = document.createElement('p')
  p.textContent = message
  box.append(p)
  if (link) {
    const a = document.createElement('a')
    a.className = 'auth-button'
    a.href = link.href
    a.textContent = link.text
    box.append(a)
  }
  target.replaceWith(box)
  box.tabIndex = -1
  box.focus()
  return box
}

/** Show / hide one of the page's status lines. */
export function say(el: HTMLElement | null, message: string, kind: 'error' | 'ok' = 'error'): void {
  if (!el) return
  el.textContent = message
  el.hidden = !message
  el.className = kind === 'error' ? 'notice notice-error' : 'notice notice-ok'
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status')
}
