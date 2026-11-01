import type {JobInfo} from '../../platform/background';
import type {AbandonedRunResult} from '../../lib/types/admin/merchandising';

/**
 * `abandoned-carts` list (schedule: every 15 minutes, background.json). WP-24 implements.
 * Port of VAREL worker/jobs/abandoned-carts.ts + worker/lib/abandoned.ts: when
 * `Setting.abandonedCartEnabled` is on, sends `abandoned_cart` (contracts `sendTemplate`) once per
 * bag contents for bags idle `abandonedCartHours`, claiming `reminderSentAt` first (idempotent,
 * at-least-once safe), at most 100 bags a run. The admin's "Check now"
 * (`POST /site-api/manage/abandoned/run`) runs the same body.
 *
 * Return = done; throw = try again later (docs/agent/background-jobs.md). 60 s per run.
 * Wave 0 stub: does nothing.
 */
export async function remindAbandonedCarts(_data: unknown, _job: JobInfo): Promise<AbandonedRunResult> {
  return {enabled: false, checked: 0, sent: 0};
}
