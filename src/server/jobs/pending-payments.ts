import type {JobInfo} from '../../platform/background';

/**
 * `pending-payments` list (schedule: every 15 minutes, background.json). WP-11 implements.
 * Port of VAREL worker/jobs/pending-payments.ts: a Pending Stripe order older than 60 minutes has
 * its PaymentIntent canceled, its stock and discount usage released (contracts `restockOrder`) and
 * its payment marked Failed; if Stripe says it was paid after all (a missed webhook), it is marked
 * Paid and confirmed instead. At most 100 orders a run; idempotent.
 *
 * Return = done; throw = try again later (docs/agent/background-jobs.md). 60 s per run.
 * Wave 0 stub: does nothing.
 */
export const PENDING_PAYMENT_MINUTES = 60;

export async function expirePendingPayments(_data: unknown, _job: JobInfo): Promise<{expired: number; paid: number}> {
  return {expired: 0, paid: 0};
}
