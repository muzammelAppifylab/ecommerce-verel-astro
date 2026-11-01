import {defineBackground} from '../platform/background';
import {remindAbandonedCarts} from './jobs/abandoned-carts';
import {expirePendingPayments} from './jobs/pending-payments';
import {type SendEmailJob, sendEmailJob} from './jobs/send-email';
import {backfillTranslations} from './jobs/translations-backfill';

/**
 * This site's BACKGROUND JOBS: one handler per list (docs/agent/background-jobs.md).
 *
 *   send:      sendJob(c.req.url, 'send-email', {messageId}, {key: `email-${messageId}`})
 *   schedule:  background.json  (VAREL's cron trigger, D10)
 *
 * The store's lists (VAREL worker/lib/scheduled.ts → one list each; the handler body lives in
 * `src/server/jobs/<list>.ts`, owned by the package named there):
 *
 *   abandoned-carts        every 15 min   abandoned-bag reminder emails          WP-24
 *   pending-payments       every 15 min   expire unpaid Stripe orders, restock   WP-11
 *   translations-backfill  hourly         machine-translate missing content      WP-25
 *   send-email             on demand      deliver one outbox email               WP-22
 *
 * A handler gets the job's data (JSON) and returns when done. Throw to try again later;
 * throw `DontRetry` (from ../platform/background) when trying again cannot help. It may run more
 * than once: make it safe to repeat. Load what you need by id from the Site Database; never put a
 * whole record (or a secret) in the data. Locally (`npm run dev`) schedules do not tick: send the
 * list a job to try it.
 */
export const background = defineBackground({
  'abandoned-carts': async (data, job) => {
    await remindAbandonedCarts(data, job);
  },
  'pending-payments': async (data, job) => {
    await expirePendingPayments(data, job);
  },
  'translations-backfill': async (data, job) => {
    await backfillTranslations(data, job);
  },
  'send-email': async (data: SendEmailJob, job) => {
    await sendEmailJob(data, job);
  },
});
