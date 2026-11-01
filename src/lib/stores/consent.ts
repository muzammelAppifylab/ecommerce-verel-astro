/* Cookie consent (VAREL src/lib/consent.ts; docs/PHASE2-3.md §9, docs/API.md "Data and privacy").
   The visitor's choice is stored in localStorage (`varel_consent`) and mirrored to a first-party cookie (`varel_consent`,
   readable by the Worker, 180 days) so it survives either being cleared. It is versioned: bumping CONSENT_VERSION
   (new categories or a materially different policy) asks everyone again.
   Analytics and any non-essential tracking must call hasConsent('analytics') before sending. */
export type ConsentCategory = 'necessary' | 'analytics'

export interface ConsentChoice {
  /** Policy version the choice was made against */
  v: number
  analytics: boolean
  /** ISO timestamp of the choice */
  at: string
}

export const CONSENT_VERSION = 1
const KEY = 'varel_consent'
const REQUIRED_KEY = 'varel_consent_required'
const MAX_AGE_S = 180 * 24 * 60 * 60
/** Fired on window when the choice changes (detail: ConsentChoice | null) */
export const CONSENT_CHANGE_EVENT = 'varel:consent-change'
/** Fired on window to reopen the settings dialog (footer "Cookie settings" link) */
export const CONSENT_OPEN_EVENT = 'varel:consent-open'

const hasWindow = () => typeof window !== 'undefined'

function parse(raw: string | null | undefined): ConsentChoice | null {
  if (!raw) return null
  try {
    const c = JSON.parse(raw) as Partial<ConsentChoice>
    if (typeof c.v !== 'number' || typeof c.analytics !== 'boolean') return null
    return { v: c.v, analytics: c.analytics, at: typeof c.at === 'string' ? c.at : '' }
  } catch {
    return null
  }
}

function readCookie(): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)varel_consent=([^;]*)/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return null
  }
}

let cached: ConsentChoice | null | undefined

/** The stored choice for the current policy version, or null when the visitor has not chosen yet. */
export function getConsent(): ConsentChoice | null {
  if (!hasWindow()) return null
  if (cached === undefined) {
    let raw: string | null = null
    try {
      raw = window.localStorage.getItem(KEY)
    } catch {
      raw = null
    }
    cached = parse(raw) ?? parse(readCookie())
  }
  return cached && cached.v === CONSENT_VERSION ? cached : null
}

/** Store a choice (localStorage + cookie) and notify listeners. */
export function setConsent(choice: { analytics: boolean }): ConsentChoice {
  const next: ConsentChoice = { v: CONSENT_VERSION, analytics: choice.analytics, at: new Date().toISOString() }
  cached = next
  const raw = JSON.stringify(next)
  try {
    window.localStorage.setItem(KEY, raw)
  } catch {
    // private mode / blocked storage: the cookie still carries the choice
  }
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${KEY}=${encodeURIComponent(raw)}; Max-Age=${MAX_AGE_S}; Path=/; SameSite=Lax${secure}`
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: next }))
  return next
}

export const acceptAll = () => setConsent({ analytics: true })
export const necessaryOnly = () => setConsent({ analytics: false })

/** Forget the choice (tests, or a "reset" link): the banner shows again. */
export function clearConsent(): void {
  cached = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
  try {
    document.cookie = `${KEY}=; Max-Age=0; Path=/; SameSite=Lax`
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: null }))
}

let required: boolean | undefined

/** Whether the store asks for consent (public setting `cookieConsent`). Remembered so the next visit knows before settings load. */
export function isConsentRequired(): boolean {
  if (required === undefined) {
    try {
      required = hasWindow() ? window.localStorage.getItem(REQUIRED_KEY) !== '0' : true
    } catch {
      required = true
    }
  }
  return required
}

/** Called by the cookie banner once public settings load. */
export function setConsentRequired(on: boolean): void {
  if (required === on) return
  required = on
  try {
    window.localStorage.setItem(REQUIRED_KEY, on ? '1' : '0')
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: getConsent() }))
}

/** True when the visitor allows this category. Necessary cookies are always allowed; with consent switched off
    in the admin every category is allowed; otherwise nothing optional runs until the visitor opts in. */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === 'necessary') return true
  if (!isConsentRequired()) return true
  return getConsent()?.[category] === true
}

/** Reopen the cookie settings dialog (the footer link). */
export function openConsentSettings(): void {
  if (hasWindow()) window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))
}

/** Subscribe to consent changes. Returns an unsubscribe function. */
export function onConsentChange(fn: (choice: ConsentChoice | null) => void): () => void {
  if (!hasWindow()) return () => {}
  const h = (e: Event) => fn((e as CustomEvent<ConsentChoice | null>).detail)
  window.addEventListener(CONSENT_CHANGE_EVENT, h)
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, h)
}
