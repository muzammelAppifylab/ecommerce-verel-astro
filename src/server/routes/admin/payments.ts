import {Hono} from 'hono';

import type {AdminPaymentsStatus} from '../../../lib/types/admin/store';
import {config} from '../../../platform/config';
import {requirePermission, withDb} from '../../../platform/guards';
import {SETTINGS_ID} from '../../lib/settings';
import {PERMISSIONS} from '../../permissions';

/**
 * Admin: payments status (port of VAREL worker/routes/admin/payments.ts): what the Payments settings
 * screen shows beyond the settings row — whether checkout is really on Stripe, the mode of each key
 * (never a key), and the webhook URL to register in the Stripe dashboard. The provider and the
 * publishable key are saved through PATCH /site-api/manage/settings.
 *
 *   GET    /site-api/manage/payments/status            AdminPaymentsStatus
 *
 * Guarded centrally (area: settings), plus `requirePermission(STORE_SETTINGS_MANAGE)`.
 * The secret key and webhook signing secret are owner secrets (`config.ownerSecret`).
 *
 * `keyMode`, the webhook path and events mirror WP-11's `src/server/lib/payments` (same values);
 * swap to its exports once it is merged.
 */

export const STRIPE_WEBHOOK_PATH = '/site-api/webhooks/stripe';
export const STRIPE_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
] as const;

/** `sk_test_…`/`pk_test_…`/`rk_test_…` → test, `…_live_…` → live, anything else null. */
export function keyMode(key: string | null | undefined): 'test' | 'live' | null {
  if (!key) return null;
  if (/^(sk|pk|rk)_test_/.test(key)) return 'test';
  if (/^(sk|pk|rk)_live_/.test(key)) return 'live';
  return null;
}

export const paymentsAdmin = new Hono().get('/status', requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE), withDb, async c => {
  c.header('Cache-Control', 'private, no-store');
  const row = await c.var.db.setting.findUnique({where: {id: SETTINGS_ID}, select: {paymentProvider: true, stripePublishableKey: true}});
  const sk = config.ownerSecret('STRIPE_SECRET_KEY');
  const selected = row?.paymentProvider === 'stripe' ? 'stripe' : 'simulated';
  const pk = row?.stripePublishableKey?.trim() || null;
  const active = selected === 'stripe' && !!sk && !!pk && /^pk_(test|live)_/.test(pk) ? 'stripe' : 'simulated';
  const origin = (config.siteUrl ?? new URL(c.req.url).origin).replace(/\/+$/, '');
  const status: AdminPaymentsStatus = {
    active,
    selected,
    secretKey: {set: !!sk, mode: keyMode(sk)},
    webhookSecret: {set: !!config.ownerSecret('STRIPE_WEBHOOK_SECRET')},
    publishableKey: {set: !!pk, mode: keyMode(pk)},
    webhookUrl: `${origin}${STRIPE_WEBHOOK_PATH}`,
    webhookEvents: [...STRIPE_WEBHOOK_EVENTS],
    apiHostOverride: false,
  };
  return c.json(status);
});
