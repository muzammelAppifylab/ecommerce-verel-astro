/* The template's auth routes answer in English (`{error, message, fields}`); the storefront speaks the
   page's language. This maps an answer to the `auth` catalog by its `error` code (VAREL showed its own
   localized messages). PURE: no DOM, unit tested (tests/onboarding.test.ts). */
import type { SubmitResult } from '../../lib/form'
import type { TFunction } from '../../lib/i18n/core'

type Failure = Extract<SubmitResult, { ok: false }>

export interface ProblemContext {
  /** Sign-in forms: a wrong email / password / invalid input is ONE generic line (`login.invalid`). */
  login?: boolean
  /** What `invalid_token` means on this page (reset / verify / confirm-email). */
  invalidToken?: string
  /** What `email_taken` means on this page. */
  emailTaken?: string
}

/** Minutes until a rate limit lifts, from `Retry-After` (seconds), at least 1. */
export function retryMinutes(retryAfter: string | null | undefined): number {
  const seconds = Number(retryAfter)
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 1
}

const EMAIL_NOT_REAL = /throwaway|get mail/i
const COMMON = /too common/i

/** A field error from the server, in the page's words. */
function fieldMessage(name: string, message: string, t: TFunction): string {
  if (name === 'email') return EMAIL_NOT_REAL.test(message) ? t('errors.emailNotReal') : t('emailInvalid')
  if (name === 'password') {
    if (COMMON.test(message)) return t('checks.common')
    if (/at least/i.test(message)) return t('minLength')
    return t('checks.unmet')
  }
  return message
}

/**
 * A failed answer as the form shows it. `res === null`: the request never got an answer.
 * `data` is the parsed body (`{error, message, fields}`), when there was one.
 */
export function localizeProblem(
  res: { status: number; headers: { get(name: string): string | null } } | null,
  data: Record<string, unknown> | null,
  t: TFunction,
  context: ProblemContext = {},
): Failure {
  if (!res) return { ok: false, message: t('errors.network') }
  const code = typeof data?.error === 'string' ? data.error : ''
  const serverMessage = typeof data?.message === 'string' ? data.message : ''
  const say = (message: string): Failure => ({ ok: false, message })

  switch (code) {
    case 'invalid_credentials':
      return say(t('login.invalid'))
    case 'invalid_input':
      if (context.login) return say(t('login.invalid'))
      break
    case 'invalid_code':
      return say(t('login.codeWrong'))
    case 'rate_limited':
      return say(t('errors.rateLimited', { count: retryMinutes(res.headers.get('retry-after')) }))
    case 'csrf_failed':
      return say(t('errors.csrf'))
    case 'auth_not_configured':
      return say(t('errors.notConfigured'))
    case 'registration_closed':
      return say(t('signup.closed'))
    case 'email_unverified':
      return say(t('errors.unverified'))
    case 'account_suspended':
      return say(t('errors.suspended'))
    case 'challenge_expired':
      return say(t('errors.challengeExpired'))
    case 'invalid_token':
      return say(context.invalidToken ?? t('errors.badLink'))
    case 'email_taken':
      return say(context.emailTaken ?? t('signup.emailTaken'))
  }

  const raw = data?.fields && typeof data.fields === 'object' ? (data.fields as Record<string, unknown>) : null
  if (raw) {
    const fields: Record<string, string> = {}
    for (const [name, message] of Object.entries(raw)) {
      if (typeof message === 'string') fields[name] = fieldMessage(name, message, t)
    }
    if (Object.keys(fields).length) return { ok: false, message: serverMessage || undefined, fields }
  }
  // Server failures: the page's words, not the core's English.
  if (res.status >= 500) return say(t('errors.generic', { status: res.status }))
  return say(serverMessage || t('errors.generic', { status: res.status }))
}
