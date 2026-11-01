import type {JobInfo} from '../../platform/background';
import {config} from '../../platform/config';
import {getDb} from '../../platform/db';
import type {DbClient} from '../lib/db';
import {getProvider} from '../lib/payments/index';
import {failOrder, markOrderPaid, sendOrderConfirmation} from '../lib/payments/lifecycle';

/**
 * `pending-payments` list (schedule: every 15 minutes, background.json). Port of VAREL
 * worker/jobs/pending-payments.ts (WP-11): a Pending Stripe order older than 60 minutes has its
 * PaymentIntent canceled, its stock and discount usage released and its payment marked Failed; if
 * Stripe says it was paid after all (a missed webhook), it is marked Paid and confirmed instead;
 * `processing` is left for the webhook. Idempotent (conditional updates).
 *
 * Bounded for the 60 s run: the 20 oldest orders a run, and no new order is started after 45 s; the
 * next tick continues. One order failing is logged and skipped. Return = done; throw (only when the
 * database is off) = try again later (docs/agent/background-jobs.md).
 */
export const PENDING_PAYMENT_MINUTES = 60;
export const PENDING_PAYMENT_BATCH = 20;
const DEADLINE_MS = 45_000;

export interface ExpireOptions {
  limit?: number;
  deadlineMs?: number;
}

/** The job's core, on a database client (tests call it with their own `now`). */
export async function expirePending(
  db: DbClient,
  now = new Date(),
  {limit = PENDING_PAYMENT_BATCH, deadlineMs = DEADLINE_MS}: ExpireOptions = {}
): Promise<{expired: number; paid: number}> {
  const started = Date.now();
  const cutoff = new Date(now.getTime() - PENDING_PAYMENT_MINUTES * 60_000);
  const orders = await db.shopOrder.findMany({
    where: {payment: 'Pending', paymentProvider: 'stripe', placedAt: {lt: cutoff}},
    select: {id: true, number: true, payments: {where: {provider: 'stripe'}, select: {providerRef: true}, take: 5}},
    orderBy: {placedAt: 'asc'},
    take: limit,
  });
  let expired = 0;
  let paid = 0;
  const mail = {db, origin: config.siteUrl ?? '', requestUrl: config.siteUrl ?? undefined};
  const keyed = !!config.ownerSecret('STRIPE_SECRET_KEY');
  for (const o of orders) {
    if (Date.now() - started > deadlineMs) break;
    try {
      const ref = o.payments.find(p => p.providerRef)?.providerRef ?? null;
      const pi = ref && keyed ? await getProvider('stripe').cancelIntent(ref) : null;
      if (pi?.status === 'succeeded') {
        if (await markOrderPaid(db, o.id, pi)) {
          paid++;
          await sendOrderConfirmation(mail, o.id);
        }
        continue;
      }
      if (pi?.status === 'processing') continue; // still settling; the webhook decides
      if (await failOrder(db, o.id, {status: 'canceled', message: null, reason: `Payment expired after ${PENDING_PAYMENT_MINUTES} minutes`})) expired++;
    } catch (err) {
      console.error(`[jobs] pending-payments: ${o.number} failed`, err instanceof Error ? err.message : 'unknown error');
    }
  }
  if (orders.length) console.info(`[jobs] pending-payments: ${expired} expired, ${paid} paid of ${orders.length}`);
  return {expired, paid};
}

/** The `pending-payments` handler (src/server/background.ts). Scheduled runs carry no data; it is ignored. */
export async function expirePendingPayments(_data: unknown, _job: JobInfo): Promise<{expired: number; paid: number}> {
  const db = getDb();
  if (!db) throw new Error('The Site Database is off.');
  return expirePending(db, new Date());
}
