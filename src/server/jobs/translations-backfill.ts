import type {JobInfo} from '../../platform/background';

/**
 * `translations-backfill` list (schedule: hourly, background.json). WP-25 implements.
 * Port of VAREL worker/jobs/translations.ts: when auto-translation is on and the provider has its
 * secrets (`config.ownerSecret`), machine-translates missing and stale automatic translations in a
 * small bounded batch (80 field-locales, well inside the 60 s run). Skips otherwise.
 *
 * Return = done; throw = try again later (docs/agent/background-jobs.md).
 * Wave 0 stub: does nothing.
 */
export const PER_RUN = 80;

export async function backfillTranslations(_data: unknown, _job: JobInfo): Promise<{translated: number; failed: number; remaining: number}> {
  return {translated: 0, failed: 0, remaining: 0};
}
