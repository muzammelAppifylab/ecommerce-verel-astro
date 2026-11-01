/* Sign-up extras kept in this browser until the first sign-in (WP-15).

   The template's `POST /site-api/auth/register` takes only `{name, email, password}` and, with email
   confirmation on, signs nobody in. VAREL's sign-up also stored first / last name and the newsletter
   choice, so the register page keeps them here and the first sign-in hands them to
   `POST /site-api/account/onboarding` (which only applies them to the account with that email).
   Kept 48 hours; every storage access is guarded (private windows, blocked storage). */

export const STASH_KEY = 'varel_signup'
export const STASH_TTL_MS = 48 * 60 * 60 * 1000

export interface SignupStash {
  v: 1
  email: string
  firstName: string
  lastName: string
  newsletter: boolean
  at: number
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function local(): Store | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function writeStash(
  data: Omit<SignupStash, 'v' | 'at'>,
  now = Date.now(),
  store: Store | null = local(),
): void {
  try {
    const value: SignupStash = { v: 1, ...data, email: data.email.trim().toLowerCase(), at: now }
    store?.setItem(STASH_KEY, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the names come from the account name instead */
  }
}

export function clearStash(store: Store | null = local()): void {
  try {
    store?.removeItem(STASH_KEY)
  } catch {
    /* ignore */
  }
}

/** The stash for `email`, or null (none, expired, unreadable, or typed for another address). */
export function readStash(email: string, now = Date.now(), store: Store | null = local()): SignupStash | null {
  let raw: string | null = null
  try {
    raw = store?.getItem(STASH_KEY) ?? null
  } catch {
    return null
  }
  if (!raw) return null
  let value: Partial<SignupStash> | null = null
  try {
    value = JSON.parse(raw) as Partial<SignupStash>
  } catch {
    value = null
  }
  const valid =
    !!value &&
    value.v === 1 &&
    typeof value.email === 'string' &&
    typeof value.at === 'number' &&
    typeof value.firstName === 'string' &&
    typeof value.lastName === 'string' &&
    typeof value.newsletter === 'boolean'
  if (!valid || now - value!.at! > STASH_TTL_MS || value!.at! > now + 60_000) {
    clearStash(store)
    return null
  }
  return value!.email === email.trim().toLowerCase() ? (value as SignupStash) : null
}
