/* Email provider contract (port of VAREL worker/lib/email/provider.ts, WP-22). Each provider is one fetch call
   (Workers runtime: no SMTP, no SDKs). A provider resolves with the provider's message id, or throws an
   EmailProviderError with a readable reason and whether trying again later can help (docs/agent/security.md
   "Calling other services": fixed origins or an owner-set https endpoint, a timeout, only the fields it needs). */

export const EMAIL_PROVIDERS = ['outbox', 'resend', 'postmark', 'ezystudio', 'webhook'] as const
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number]

export const isEmailProvider = (v: unknown): v is EmailProviderName => (EMAIL_PROVIDERS as readonly unknown[]).includes(v)

export interface OutgoingEmail {
  /** The EmailMessage id: the idempotency key (`email-<id>`) where the provider supports one. */
  id?: number | string | null
  from: { name: string; email: string }
  to: string
  replyTo?: string | null
  subject: string
  html: string
  text: string
  /** Template key, sent as a tag */
  template: string | null
  related?: { type: string; id: string } | null
}

/** Non-secret provider settings (Setting.emailConfig). */
export interface ProviderConfig {
  /** ezystudio / webhook: the URL to POST to */
  endpoint?: string
  /** postmark: message stream, default "outbound" */
  messageStream?: string
  [key: string]: string | undefined
}

export interface ProviderOptions {
  /** `config.ownerSecret('EMAIL_API_KEY')`, read at delivery time; never logged, never stored. */
  apiKey?: string | null
  config: ProviderConfig
}

export type ProviderSend = (msg: OutgoingEmail, opts: ProviderOptions) => Promise<{ id: string | null }>

/**
 * A provider refused or could not be reached. `retryable`: a network failure, a timeout, 408, 429 or 5xx
 * (the job tries again later); `config`: the store's setup is incomplete (no key, no endpoint), so trying
 * again cannot help until the owner fixes it.
 */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly config = false,
  ) {
    super(message)
    this.name = 'EmailProviderError'
  }
}

export const TIMEOUT_MS = 10_000

/** "VAREL <care@varel.studio>" with the name quoted when it needs to be. */
export function formatAddress(a: { name: string; email: string }): string {
  const name = a.name.trim()
  if (!name) return a.email
  return /[",<>@()]/.test(name) ? `"${name.replace(/"/g, '\\"')}" <${a.email}>` : `${name} <${a.email}>`
}

/** The `Idempotency-Key` header for one outbox row: a retried job after a lost answer does not send twice. */
export const idempotencyHeader = (msg: OutgoingEmail): Record<string, string> =>
  msg.id != null && msg.id !== '' ? { 'Idempotency-Key': `email-${msg.id}` } : {}

const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500

/** POST JSON with a timeout; returns the parsed body. Non-2xx throws with the provider's message. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    })
  } catch (e) {
    const reason =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
        ? `timed out after ${TIMEOUT_MS / 1000} s`
        : e instanceof Error
          ? e.message
          : String(e)
    throw new EmailProviderError(`Could not reach ${new URL(url).host}: ${reason}`.slice(0, 300), true)
  }
  const raw = (await res.text().catch(() => '')).slice(0, 20_000)
  let json: Record<string, unknown> = {}
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    json = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    json = {}
  }
  if (!res.ok) {
    const msg = String(json.message ?? json.Message ?? json.error ?? (raw.slice(0, 200) || res.statusText || 'error')).slice(0, 200)
    throw new EmailProviderError(`${res.status} ${msg}`, retryableStatus(res.status))
  }
  return json
}

export function requireKey(opts: ProviderOptions, provider: string): string {
  if (!opts.apiKey) {
    throw new EmailProviderError(`EMAIL_API_KEY is not added, so ${provider} cannot send. Add it in the dashboard's secrets.`, false, true)
  }
  return opts.apiKey
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const PRIVATE_SUFFIX = /(^|\.)(localhost|local|internal|localdomain|home|lan|intranet|corp)$/i

/**
 * An owner-set endpoint is used only when it is an absolute `https://` URL to a public DNS name: no IP
 * literal, no `localhost`/`.local`/`.internal`, no user:password, the default port. Checked when the
 * setting is saved (src/server/lib/email/delivery.ts) and again here before every call.
 */
export function endpointProblem(raw: string | undefined | null): string | null {
  const value = raw?.trim()
  if (!value) return 'missing'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'https:') return 'invalid'
  if (url.username || url.password || url.port) return 'invalid'
  const host = url.hostname.toLowerCase()
  if (!host || host.startsWith('[') || host.includes(':') || IPV4.test(host)) return 'invalid'
  if (!host.includes('.') || PRIVATE_SUFFIX.test(host)) return 'invalid'
  if (!/^[a-z0-9.-]+$/.test(host) || host.endsWith('.')) return 'invalid'
  return null
}

export function requireEndpoint(opts: ProviderOptions, provider: string): string {
  const problem = endpointProblem(opts.config.endpoint)
  if (problem === 'missing') {
    throw new EmailProviderError(`Set an endpoint URL for ${provider} in Settings · Emails · Delivery`, false, true)
  }
  if (problem) {
    throw new EmailProviderError(`The endpoint for ${provider} must be a full https:// link to a public address`, false, true)
  }
  return opts.config.endpoint!.trim()
}
