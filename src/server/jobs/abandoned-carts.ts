import {config} from '../../platform/config';
import {getDb} from '../../platform/db';
import {DontRetry, type JobInfo} from '../../platform/background';
import type {AbandonedRunResult} from '../../lib/types/admin/merchandising';
import {abandonedInclude, abandonedSettings, type AbandonedRow, type RemindOutcome, sendReminder} from '../lib/abandoned';
import type {Db} from '../lib/db';
import {dueBagIds, olderBagIds, siblingsOf} from '../routes/admin/abandoned-scan';

/**
 * `abandoned-carts` list (schedule: every 15 minutes, background.json). Port of VAREL
 * worker/jobs/abandoned-carts.ts: when `Setting.abandonedCartEnabled` is on, sends `abandoned_cart`
 * (contracts `sendTemplate`) once per bag contents for bags idle `abandonedCartHours`, claiming
 * `reminderSentAt` first (idempotent, at-least-once safe). The admin's "Send due reminders"
 * (`POST /site-api/manage/abandoned/run`) runs the same body (`runAbandonedReminders`).
 *
 * Differences from VAREL (docs/migration/handoff/WP-24.md):
 * - the due bags come from ONE aggregate query ordered by true last activity, oldest first
 *   (`dueBagIds`), not from the most recently updated carts filtered in memory;
 * - at most REMIND_PER_RUN reminders per run: each one queues a `send-email` job and the platform
 *   allows about 10 job adds a minute. The rest are picked up 15 minutes later.
 *
 * Return = done; throw = try again later (docs/agent/background-jobs.md). 60 s per run.
 */

/** Most reminders sent per run (VAREL: 50; here bounded by the job-add rate, see above). */
export const REMIND_PER_RUN = 8;
/** Candidates read per run: headroom for bags skipped as superseded, ordered or without an email. */
const CANDIDATES = REMIND_PER_RUN * 3;
const HOUR = 60 * 60 * 1000;

export interface AbandonedRunContext {
  /** The site's origin for the recovery link (config.siteUrl, or the admin request's origin). */
  origin: string;
  /** Signs the recovery link (config.jwtSecret). */
  secret: string;
  /** The current request's URL (sendJob needs it). Not passed on yet: F4 `RemindContext` has no slot (Request). */
  requestUrl?: string;
  now?: Date;
}

export type AbandonedRunOutcomes = Partial<Record<RemindOutcome | 'superseded' | 'error', number>>;
export type AbandonedRunReport = AbandonedRunResult & {outcomes: AbandonedRunOutcomes};

/** The job body, reusable from the admin ("Send due reminders") and tests. Never throws per bag. */
export async function runAbandonedReminders(db: Db, ctx: AbandonedRunContext): Promise<AbandonedRunReport> {
  const settings = await abandonedSettings(db);
  const result: AbandonedRunReport = {enabled: settings.enabled, checked: 0, sent: 0, outcomes: {}};
  if (!settings.enabled) return result;

  const now = ctx.now ?? new Date();
  const ids = await dueBagIds(db, new Date(now.getTime() - settings.hours * HOUR), CANDIDATES);
  if (!ids.length) return result;

  const rows = await db.cart.findMany({where: {id: {in: ids}}, include: abandonedInclude, take: ids.length});
  const byId = new Map(rows.map(r => [r.id, r]));
  const due = ids.map(id => byId.get(id)).filter((c): c is AbandonedRow => !!c && c.lines.length > 0);
  // A newer bag of the same shopper (even one not idle yet) supersedes an older one.
  const siblings = await siblingsOf(db, due);
  const older = olderBagIds([...due, ...siblings]);
  const remindCtx = {db, origin: ctx.origin, secret: ctx.secret};
  const count = (k: keyof AbandonedRunOutcomes) => (result.outcomes[k] = (result.outcomes[k] ?? 0) + 1);

  for (const cart of due) {
    if (result.sent >= REMIND_PER_RUN) break;
    result.checked++;
    if (older.has(cart.id)) {
      count('superseded');
      continue;
    }
    let outcome: RemindOutcome | 'error';
    try {
      outcome = await sendReminder(remindCtx, cart);
    } catch (e) {
      console.error('[jobs] abandoned bag reminder failed', cart.id, e instanceof Error ? e.message : 'unknown error');
      outcome = 'error';
    }
    count(outcome);
    if (outcome === 'sent') result.sent++;
  }
  if (result.checked) console.log(`[jobs] abandoned bags: ${result.sent} reminder(s) sent of ${result.checked} checked`);
  return result;
}

/** The scheduled handler (src/server/background.ts). Throws (retry) only when the database is unreachable. */
export async function remindAbandonedCarts(_data: unknown, _job: JobInfo): Promise<AbandonedRunResult> {
  const db = getDb();
  if (!db) throw new Error('The Site Database is not reachable');
  const origin = config.siteUrl;
  if (!origin) throw new DontRetry('The site address is not set, so reminder links cannot be built.');
  const secret = config.jwtSecret;
  if (!secret) throw new DontRetry('Sign-in is not configured, so reminder links cannot be signed.');
  return runAbandonedReminders(db, {origin, secret, requestUrl: origin});
}
