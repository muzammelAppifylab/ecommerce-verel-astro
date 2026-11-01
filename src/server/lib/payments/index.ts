/* Payment providers (port of VAREL worker/lib/payments/index.ts, PLAN.md D3).
   - stripe: PaymentIntents + the Payment Element. Active when Setting.paymentProvider is "stripe", the owner added the
     `STRIPE_SECRET_KEY` secret and a publishable key is saved in Settings → Payments.
   - simulated: the card is checked and paid on the spot. The default, and the fallback whenever Stripe isn't configured.
   Orders keep the provider they were placed with (ShopOrder.paymentProvider), so refunds go back the same way.
   Amounts are integer CENTS of the store currency in every interface here (the database's unit). */
import { config } from '../../../platform/config'
import type { Db } from '../db'
import { HttpError } from '../errors'
import { stripeProvider } from './stripe'

export type ProviderName = 'stripe' | 'simulated'

/** Where Stripe posts its events (Stripe dashboard → Developers → Webhooks). */
export const STRIPE_WEBHOOK_PATH = '/site-api/webhooks/stripe'

/** The events the webhook handles (subscribe the endpoint to exactly these). */
export const STRIPE_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
] as const

export interface IntentInfo {
  ref: string
  /** Stripe PaymentIntent status: requires_payment_method | requires_confirmation | requires_action | processing |
      requires_capture | canceled | succeeded */
  status: string
  brand: string | null
  last4: string | null
  failureMessage: string | null
}

export interface CreateIntentInput {
  amountCents: number
  currency: string // ISO 4217
  orderId: number
  orderNumber: string
  email: string
  storeName: string
}

export interface RefundInput {
  ref: string
  amountCents: number
  currency: string
  /** Same key → same refund (a retried request never refunds twice). */
  idempotencyKey: string
}

export interface PaymentProvider {
  readonly name: ProviderName
  createIntent(i: CreateIntentInput): Promise<{ ref: string; clientSecret: string }>
  getIntent(ref: string): Promise<IntentInfo>
  cancelIntent(ref: string): Promise<IntentInfo>
  refund(i: RefundInput): Promise<{ id: string; amountCents: number }>
}

/** Simulated orders are paid at checkout; refunds and cancels only move the order's own records. */
const simulatedProvider: PaymentProvider = {
  name: 'simulated',
  async createIntent() {
    throw new HttpError(500, 'SERVER_ERROR', 'Simulated payments do not use payment intents')
  },
  async getIntent(ref) {
    return { ref, status: 'succeeded', brand: null, last4: null, failureMessage: null }
  },
  async cancelIntent(ref) {
    return { ref, status: 'canceled', brand: null, last4: null, failureMessage: null }
  },
  async refund(i) {
    return { id: `sim_re_${crypto.randomUUID().slice(0, 12)}`, amountCents: i.amountCents }
  },
}

export function getProvider(name: string): PaymentProvider {
  return name === 'stripe' ? stripeProvider() : simulatedProvider
}

export interface PaymentConfig {
  /** What checkout uses right now. */
  provider: ProviderName
  /** What the admin chose (may be "stripe" while Stripe is not configured yet). */
  selected: ProviderName
  publishableKey: string | null
  currency: string
  storeName: string
}

/** Stripe can take payments: the secret key is set and a well-formed publishable key is saved. */
export const stripeReady = (publishableKey: string | null | undefined, secret = config.ownerSecret('STRIPE_SECRET_KEY')) =>
  !!secret && !!publishableKey && /^pk_(test|live)_/.test(publishableKey)

/** The provider checkout uses, from the settings row and the owner's secrets. */
export async function paymentConfig(db: Db): Promise<PaymentConfig> {
  const s = await db.setting.findUnique({
    where: { id: 1 },
    select: { paymentProvider: true, stripePublishableKey: true, currency: true, storeName: true },
  })
  const selected: ProviderName = s?.paymentProvider === 'stripe' ? 'stripe' : 'simulated'
  const publishableKey = s?.stripePublishableKey?.trim() || null
  const provider: ProviderName = selected === 'stripe' && stripeReady(publishableKey) ? 'stripe' : 'simulated'
  return {
    provider,
    selected,
    publishableKey: provider === 'stripe' ? publishableKey : null,
    currency: (s?.currency || 'USD').toUpperCase(),
    storeName: s?.storeName || 'VAREL',
  }
}

/** "test" / "live" from a Stripe key prefix, null when there is no key. */
export function keyMode(key: string | null | undefined): 'test' | 'live' | null {
  if (!key) return null
  if (/^(sk|pk|rk)_test_/.test(key)) return 'test'
  if (/^(sk|pk|rk)_live_/.test(key)) return 'live'
  return null
}
