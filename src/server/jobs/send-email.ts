import {DontRetry, type JobInfo} from '../../platform/background';
import {getDb} from '../../platform/db';
import {deliverMessage, sweepQueued} from '../lib/email/send';

/**
 * The data of a `send-email` job: the outbox row to deliver (never the email itself, the address or a key),
 * or `{sweep: true}` from the `send-email-sweep` schedule (Request R3 in docs/migration/handoff/WP-22.md).
 */
export interface SendEmailJob {
  messageId?: string;
  sweep?: boolean;
}

/**
 * `send-email` list (WP-22; VAREL delivered in waitUntil, worker/lib/email/send.ts). One job per queued message,
 * sent by `sendTemplate` from a route with the key `email-<id>`.
 *
 * - Row missing: on the first two tries it may still be in an uncommitted transaction → throw (try again); later → done.
 * - Not `queued` any more (sent, failed, stored): done, at-least-once safe. Another run holds it: done.
 * - Provider outage (network, timeout, 408, 429, 5xx) → the row stays `queued` and this throws: the platform tries
 *   again (1 min, 2 min, 10 min, 1 h). On the last try it is recorded `failed`.
 * - Missing key or endpoint → `failed` + `DontRetry` (the owner sees why in the Jobs tab). A provider refusal (4xx)
 *   is recorded `failed` and the job is done.
 * - `{sweep: true}`: delivers up to 10 messages left queued for over 2 minutes and fails those queued for 7 days.
 */
export async function sendEmailJob(data: SendEmailJob, job: JobInfo): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('The Site Database is off.');
  if (data?.sweep) {
    const r = await sweepQueued(db);
    if (r.expired || r.delivered || r.failed) {
      console.info(`[email] sweep: ${r.delivered} delivered, ${r.failed} failed, ${r.expired} expired`);
    }
    return;
  }
  const raw = String(data?.messageId ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new DontRetry('This job has no valid email id.');
  const id = Number(raw);
  const r = await deliverMessage(db, id, job);
  if (r.noop === 'missing') {
    if (job.attempt <= 2) throw new Error(`Email ${id} is not in the database yet.`);
    return;
  }
  if (r.retry) throw new Error(`The email provider did not take email ${id}: ${r.error ?? 'unknown error'}`);
  if (r.status === 'failed' && r.config) throw new DontRetry(r.error ?? 'The email provider is not set up.');
}
