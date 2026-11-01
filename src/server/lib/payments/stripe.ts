/* Stripe on the Worker: a small REST client over `fetch` and a WebCrypto webhook verifier.
   Port of VAREL worker/lib/payments/stripe.ts. VAREL used the `stripe` SDK (23.x, API version 2026-09-30.endive);
   the SDK is not installed here (PLAN.md §3.2), so the five calls VAREL made are plain form-encoded requests with
   the same API version, idempotency keys and one retry. `STRIPE_API_HOST` (stripe-mock) is dropped: tests stub
   `fetch`. The secret key comes only from `config.ownerSecret('STRIPE_SECRET_KEY')` and never appears in a log,
   an error or a response. Amounts in this module's public API are integer CENTS of the store currency. */
import { config } from '../../../platform/config'
import { HttpError } from '../errors'
import type { IntentInfo, PaymentProvider } from './index'

export const STRIPE_API = 'https://api.stripe.com'
/** The API version VAREL's SDK pinned (stripe@23). */
export const STRIPE_API_VERSION = '2026-09-30.endive'
const TIMEOUT_MS = 10_000

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

/** Cents (2-decimal minor units, as the database stores money) → the currency's minor unit, as Stripe expects
    (cents; yen as whole yen; three-decimal currencies ×10). */
export function toStripeAmount(cents: number, currency: string): number {
  const c = currency.toUpperCase()
  if (ZERO_DECIMAL.has(c)) return Math.round(cents / 100)
  if (THREE_DECIMAL.has(c)) return Math.round(cents) * 10
  return Math.round(cents)
}

/** Stripe's minor unit → cents. */
export function centsFromStripe(minor: number, currency: string): number {
  const c = currency.toUpperCase()
  if (ZERO_DECIMAL.has(c)) return Math.round(minor) * 100
  if (THREE_DECIMAL.has(c)) return Math.round(minor / 10)
  return Math.round(minor)
}

// ─── Wire shapes (the fields VAREL read) ───────────────────────────────────────

export interface StripePaymentMethod {
  id: string
  type: string
  card?: { brand: string; last4: string } | null
}

export interface StripePaymentIntent {
  id: string
  status: string
  client_secret?: string | null
  amount?: number
  currency?: string
  payment_method?: string | StripePaymentMethod | null
  last_payment_error?: { message?: string | null } | null
  metadata?: Record<string, string> | null
}

export interface StripeCharge {
  id: string
  amount_refunded: number
  currency: string
  refunded: boolean
  payment_intent?: string | { id: string } | null
}

export interface StripeRefund {
  id: string
  amount: number
  currency?: string
  status?: string
}

/** A Stripe API failure: Stripe's own message (never the request, never the key). */
export class StripeApiError extends Error {
  readonly name = 'StripeApiError'
  constructor(
    message: string,
    readonly status = 0,
    readonly code: string | null = null,
  ) {
    super(message)
  }
}

// Stripe redacts keys in its messages ("sk_test_****abcd"); strip what is left anyway.
const scrub = (s: string) => s.replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, '[key]').slice(0, 300)

/** Stripe's own message, wrapped as 502 PAYMENT_PROVIDER_ERROR ("Stripe: …"). */
export function providerError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  const msg = err instanceof Error && err.message ? err.message : 'Stripe did not respond'
  return new HttpError(502, 'PAYMENT_PROVIDER_ERROR', `Stripe: ${scrub(msg)}`)
}

type Params = Record<string, unknown>

/** Stripe's form encoding: nested objects as `a[b]=…`, arrays of scalars as `a[]=…`, of objects as `a[0][b]=…`. */
export function formEncode(params: Params): string {
  const out = new URLSearchParams()
  const add = (key: string, v: unknown): void => {
    if (v === undefined || v === null) return
    if (Array.isArray(v)) {
      v.forEach((x, i) => add(x !== null && typeof x === 'object' ? `${key}[${i}]` : `${key}[]`, x))
      return
    }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Params)) add(`${key}[${k}]`, x)
      return
    }
    out.append(key, String(v))
  }
  for (const [k, v] of Object.entries(params)) add(k, v)
  return out.toString()
}

export interface StripeRequestOptions {
  /** Same key → Stripe answers the first result again (a retry never charges or refunds twice). */
  idempotencyKey?: string
}

/** One Stripe API call. Retries once on a network error or a 5xx, and only when the call is safe to repeat (a GET
    or a POST carrying an idempotency key). Throws `StripeApiError`. */
export async function stripeRequest<T extends object>(
  method: 'GET' | 'POST',
  path: string,
  params: Params = {},
  opts: StripeRequestOptions = {},
): Promise<T> {
  const secret = config.ownerSecret('STRIPE_SECRET_KEY')
  if (!secret) throw new StripeApiError('Stripe is not configured (STRIPE_SECRET_KEY is missing)')
  const encoded = formEncode(params)
  const url = `${STRIPE_API}${path}${method === 'GET' && encoded ? `?${encoded}` : ''}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Stripe-Version': STRIPE_API_VERSION,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  const repeatable = method === 'GET' || !!opts.idempotencyKey

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? encoded : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      if (repeatable && attempt === 0) continue
      throw new StripeApiError('Stripe did not respond')
    }
    if (res.status >= 500 && repeatable && attempt === 0) {
      await res.body?.cancel().catch(() => undefined)
      continue
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      const e = (data as { error?: { message?: unknown; code?: unknown } } | null)?.error
      const message = typeof e?.message === 'string' && e.message ? e.message : `Stripe answered ${res.status}`
      throw new StripeApiError(scrub(message), res.status, typeof e?.code === 'string' ? e.code : null)
    }
    if (!data || typeof data !== 'object') throw new StripeApiError('Stripe sent an answer we could not read', res.status)
    return data as T
  }
}

const isIntent = (x: unknown): x is StripePaymentIntent =>
  !!x && typeof x === 'object' && typeof (x as StripePaymentIntent).id === 'string' && typeof (x as StripePaymentIntent).status === 'string'

function intentOf(x: unknown): StripePaymentIntent {
  if (!isIntent(x)) throw new StripeApiError('Stripe sent an answer we could not read')
  return x
}

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  cartes_bancaires: 'Cartes Bancaires',
}

/** Brand, last 4 and failure message of a PaymentIntent (truncated to their columns: brand 20, message 500). */
export function intentInfo(pi: StripePaymentIntent): IntentInfo {
  let brand: string | null = null
  let last4: string | null = null
  const pm = pi.payment_method
  if (pm && typeof pm === 'object') {
    if (pm.card) {
      brand = BRANDS[pm.card.brand] ?? pm.card.brand
      last4 = typeof pm.card.last4 === 'string' ? pm.card.last4.slice(-4) : null
    } else if (typeof pm.type === 'string') {
      brand = pm.type.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())
    }
  }
  const failure = pi.last_payment_error?.message
  return {
    ref: pi.id,
    status: pi.status,
    brand: brand ? brand.slice(0, 20) : null,
    last4,
    failureMessage: typeof failure === 'string' && failure ? failure.slice(0, 500) : null,
  }
}

const seg = (ref: string) => encodeURIComponent(ref)

/** Retrieve a PaymentIntent with its payment method expanded (card brand + last 4). */
export async function retrieveIntent(ref: string): Promise<StripePaymentIntent> {
  return intentOf(await stripeRequest('GET', `/v1/payment_intents/${seg(ref)}`, { expand: ['payment_method'] }))
}

export function stripeProvider(): PaymentProvider {
  return {
    name: 'stripe',
    async createIntent(i) {
      try {
        const pi = intentOf(
          await stripeRequest(
            'POST',
            '/v1/payment_intents',
            {
              amount: toStripeAmount(i.amountCents, i.currency),
              currency: i.currency.toLowerCase(),
              automatic_payment_methods: { enabled: true },
              receipt_email: i.email,
              description: `${i.storeName} order ${i.orderNumber}`,
              metadata: { orderNumber: i.orderNumber, orderId: String(i.orderId) },
            },
            { idempotencyKey: `order-${i.orderId}` },
          ),
        )
        if (typeof pi.client_secret !== 'string' || !pi.client_secret) throw new StripeApiError('No client secret was returned')
        return { ref: pi.id, clientSecret: pi.client_secret }
      } catch (err) {
        throw providerError(err)
      }
    },
    async getIntent(ref) {
      try {
        return intentInfo(await retrieveIntent(ref))
      } catch (err) {
        throw providerError(err)
      }
    },
    async cancelIntent(ref) {
      try {
        return intentInfo(intentOf(await stripeRequest('POST', `/v1/payment_intents/${seg(ref)}/cancel`, { cancellation_reason: 'abandoned' })))
      } catch (err) {
        // Already canceled or succeeded: report what it is now.
        try {
          return intentInfo(await retrieveIntent(ref))
        } catch {
          throw providerError(err)
        }
      }
    },
    async refund(i) {
      try {
        const r = await stripeRequest<StripeRefund>(
          'POST',
          '/v1/refunds',
          { payment_intent: i.ref, amount: toStripeAmount(i.amountCents, i.currency), reason: 'requested_by_customer' },
          { idempotencyKey: i.idempotencyKey },
        )
        if (typeof r.id !== 'string' || typeof r.amount !== 'number') throw new StripeApiError('Stripe sent an answer we could not read')
        return { id: r.id, amountCents: centsFromStripe(r.amount, i.currency) }
      } catch (err) {
        throw providerError(err)
      }
    },
  }
}

// ─── Webhook signatures (replaces stripe.webhooks.constructEventAsync) ─────────

const enc = new TextEncoder()

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Check a `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=…]`) over the raw body: HMAC-SHA256 of
    `${t}.${body}` with the endpoint secret, compared in constant time against every v1, and the timestamp within
    `toleranceSeconds` of now. */
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!header || !secret) return false
  let t: string | null = null
  const v1: string[] = []
  for (const part of header.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 't') t = v
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase())
  }
  if (!t || !/^\d{1,12}$/.test(t) || !v1.length) return false
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSeconds) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)))
  let ok = false
  for (const sig of v1) ok = sameText(sig, expected) || ok
  return ok
}

/** A `Stripe-Signature` header for a payload (tests and local tooling). */
export async function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `t=${timestamp},v1=${hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`)))}`
}
