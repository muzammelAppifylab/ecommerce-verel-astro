import {DontRetry, type JobInfo} from '../../platform/background';
import {getDb} from '../../platform/db';
import {runBackfill} from '../lib/i18n/backfill';
import type {TranslatableEntity} from '../lib/i18n/localize';
import {providerReady} from '../lib/i18n/providers';
import {isEntity} from '../lib/i18n/sources';
import {loadI18nConfig, translateRecord} from '../lib/i18n/translate';

/**
 * `translations-backfill` list (schedule: hourly, background.json). Port of VAREL worker/jobs/translations.ts plus
 * the work VAREL's save hook did in `waitUntil` (worker/lib/i18n/hooks.ts):
 *
 *   no data (the schedule)   when auto-translation is on and the provider has its secrets
 *                            (`config.ownerSecret`), machine-translates missing and stale automatic translations
 *                            in a small bounded batch (80 field-locales, 40 s, 400 provider strings: well inside
 *                            the 60 s run and the Worker's subrequest cap). Provider failures are counted and
 *                            retried on the next run; the schedule never throws for them.
 *   {entity, id}             one saved record (sent by `queueEntityTranslation`, src/server/lib/contracts.ts): its
 *                            fields, plus a product's colours and a post's category. Throws when the provider
 *                            answered nothing (one retry, background.json); DontRetry on bad data.
 *
 * Return = done; throw = try again later (docs/agent/background-jobs.md).
 */
export const PER_RUN = 80;

export async function backfillTranslations(data: unknown, job: JobInfo): Promise<{translated: number; failed: number; remaining: number}> {
  const none = {translated: 0, failed: 0, remaining: 0};
  const record = parseJob(data);
  const db = getDb();
  if (!db) throw new Error('The Site Database is off.');
  const cfg = await loadI18nConfig(db);
  if (!providerReady(cfg.provider)) return none;

  if (record) {
    const r = await translateRecord(db, record.entity, record.id, {config: cfg});
    if (r.failed && !r.translated) throw new Error('The translation provider did not answer; trying again later.');
    if (r.translated || r.failed) {
      console.log(`[jobs] translations ${record.entity}:${record.id}: ${r.translated} translated, ${r.failed} failed (${job.id})`);
    }
    return {translated: r.translated, failed: r.failed, remaining: r.failed};
  }

  if (!cfg.autoTranslate) return none;
  const r = await runBackfill(db, cfg, {limit: PER_RUN, budgetMs: 40_000, maxCalls: 400});
  if (r.translated || r.failed) console.log(`[jobs] translations: ${r.translated} translated, ${r.failed} failed, ${r.remaining} remaining`);
  return r;
}

/** `null` / `{}` = the scheduled backfill; `{entity, id}` = one record; anything else cannot succeed. */
export function parseJob(data: unknown): {entity: TranslatableEntity; id: string} | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object' || Array.isArray(data)) throw new DontRetry('Unknown translation job');
  const o = data as Record<string, unknown>;
  if (!Object.keys(o).length) return null;
  const {entity, id} = o;
  if (typeof entity !== 'string' || !isEntity(entity) || entity === 'ui') throw new DontRetry('Unknown translation job');
  if (typeof id !== 'string' || !id.trim() || id.length > 120 || id.includes('\u0000')) throw new DontRetry('Unknown translation job');
  return {entity, id};
}
