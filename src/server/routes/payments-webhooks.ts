import {Hono} from 'hono';

import {readCapped} from '../../platform/background';
import {config} from '../../platform/config';
import {getDb} from '../../platform/db';
import type {DbClient} from '../lib/db';
import {apiError} from '../lib/http';
import {failOrder, markOrderPaid, sendOrderConfirmation} from '../lib/payments/lifecycle';
import {
  centsFromStripe,
  intentInfo,
  retrieveIntent,
  stripeRequest,
  verifyStripeSignature,
  type StripeCharge,
  type StripePaymentIntent,
} from '../lib/payments/stripe';

/**
 * Payment provider webhooks. Port of VAREL worker/routes/webhooks.ts (WP-11).
 *
 *   POST   /site-api/webhooks/stripe                   Stripe events (payment_intent.*, charge.refunded) → 200
 *
 * Mounted BEFORE `sameOrigin`, `csrf` and the 64 KB body limit (src/server/app.ts): Stripe posts cross-site.
 * The raw body (≤ 512 KB) is checked against `Stripe-Signature` with the owner's `STRIPE_WEBHOOK_SECRET`
 * (HMAC-SHA256, 5-minute tolerance) BEFORE it is parsed. Every handler is idempotent (conditional updates on
 * ShopOrder.payment; `charge.refunded` SETS Stripe's running total), so Stripe's retries and replays change nothing
 * and send no second email: no event-id table is needed (the managed `payment_events` table belongs to the
 * platform's payments). Events: payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled,
 * charge.refunded; anything else is acknowledged and ignored.
 */

const MAX_BODY = 512 * 1024;

interface StripeEvent {
  id: string;
  type: string;
  data: {object: Record<string, unknown>};
}

const isEvent = (x: unknown): x is StripeEvent => {
  const e = x as StripeEvent | null;
  return (
    !!e &&
    typeof e === 'object' &&
    typeof e.id === 'string' &&
    typeof e.type === 'string' &&
    !!e.data &&
    typeof e.data === 'object' &&
    !!e.data.object &&
    typeof e.data.object === 'object'
  );
};

const isIntent = (x: Record<string, unknown>): x is Record<string, unknown> & StripePaymentIntent =>
  typeof x.id === 'string' && typeof x.status === 'string';

/** The order a PaymentIntent pays for: by the stored reference, else by `metadata.orderNumber` (the reference is
    then stored: Stripe answered, then the write raced). */
async function orderFor(db: DbClient, pi: StripePaymentIntent): Promise<number | null> {
  const payment = await db.shopPayment.findUnique({where: {providerRef: pi.id}, select: {orderId: true}});
  if (payment) return payment.orderId;
  const number = pi.metadata?.orderNumber;
  if (typeof number !== 'string' || !number || number.length > 20) return null;
  const order = await db.shopOrder.findUnique({where: {number}, select: {id: true, paymentProvider: true}});
  if (!order || order.paymentProvider !== 'stripe') return null;
  await db.shopPayment.updateMany({where: {orderId: order.id, provider: 'stripe', providerRef: null}, data: {providerRef: pi.id}});
  return order.id;
}

/** Mounted at `/site-api/webhooks` (src/server/app.ts). */
export const paymentWebhookRoutes = new Hono().post('/stripe', async c => {
  const secret = config.ownerSecret('STRIPE_WEBHOOK_SECRET');
  if (!secret) return apiError(c, 503, 'not_configured', 'Stripe webhooks are not configured');
  const signature = c.req.header('stripe-signature');
  if (!signature) return apiError(c, 400, 'bad_signature', 'Missing Stripe-Signature');
  const payload = await readCapped(c.req.raw, MAX_BODY);
  if (payload === null) return apiError(c, 413, 'too_large', 'That request is too large');

  if (!(await verifyStripeSignature(payload, signature, secret, 300))) {
    console.warn('[webhook] signature check failed');
    return apiError(c, 400, 'bad_signature', 'The signature does not match');
  }
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    event = null;
  }
  if (!isEvent(event)) return apiError(c, 400, 'bad_request', 'That is not a Stripe event');

  const db = getDb();
  if (!db) return apiError(c, 503, 'site_database_disabled', 'This site has no Site Database yet.');
  const mail = {db, origin: config.siteUrl ?? new URL(c.req.url).origin, requestUrl: c.req.url};

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        if (!isIntent(pi)) break;
        const orderId = await orderFor(db, pi);
        if (!orderId) break;
        // The event carries the payment method id only; ask Stripe for the card (brand, last4) when we can.
        let info = intentInfo(pi);
        if (!info.last4 && typeof pi.payment_method === 'string') {
          try {
            info = intentInfo(await retrieveIntent(pi.id));
          } catch {
            /* keep what the event had */
          }
        }
        if (await markOrderPaid(db, orderId, info)) await sendOrderConfirmation(mail, orderId);
        break;
      }
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const pi = event.data.object;
        if (!isIntent(pi)) break;
        const orderId = await orderFor(db, pi);
        if (!orderId) break;
        const canceled = event.type === 'payment_intent.canceled';
        await failOrder(db, orderId, {
          status: canceled ? 'canceled' : 'failed',
          message: intentInfo(pi).failureMessage,
          reason: canceled ? 'Payment cancelled' : 'Payment failed',
        });
        // A failed attempt leaves the PaymentIntent open; cancel it so it can't be paid for a released order.
        if (!canceled) {
          try {
            await stripeRequest('POST', `/v1/payment_intents/${encodeURIComponent(pi.id)}/cancel`, {});
          } catch {
            /* already canceled or settled */
          }
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Partial<StripeCharge>;
        const ref = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (!ref || typeof charge.amount_refunded !== 'number' || typeof charge.currency !== 'string') break;
        const p = await db.shopPayment.findUnique({where: {providerRef: ref}, select: {id: true, status: true}});
        if (!p) break;
        // Stripe's running total is the truth: setting it (not adding) makes retries harmless.
        const refundedCents = Math.max(0, centsFromStripe(charge.amount_refunded, charge.currency));
        await db.shopPayment.update({
          where: {id: p.id},
          data: {
            refundedCents,
            status: charge.refunded ? 'refunded' : refundedCents > 0 ? 'partially_refunded' : p.status,
          },
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[webhook] handler failed', event.type, err instanceof Error ? err.message : 'unknown error');
    // 500 → Stripe retries later.
    return apiError(c, 500, 'server_error', 'The event could not be processed');
  }
  return c.json({received: true});
});
