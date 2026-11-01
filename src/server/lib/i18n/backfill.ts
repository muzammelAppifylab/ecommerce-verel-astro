/* Fill missing and stale automatic translations in bounded runs (port of VAREL worker/lib/i18n/backfill.ts): the
   hourly `translations-backfill` job and the admin "Translate missing". Manual translations are never touched.
   Work is grouped per record so one provider batch covers its fields.
   Added for the Worker's limits: `maxCalls` stops starting new records once the provider has been sent that many
   strings (Workers AI makes one subrequest per string), next to VAREL's `limit` and `budgetMs`. What is not done
   counts as `remaining`. */
import type { Db } from '../db'
import { getProvider, type TranslationProvider } from './providers'
import { CONTENT_ENTITIES } from './sources'
import { entityCells, needsAuto } from './status'
import { hashMemo, translateEntity, type I18nConfig, type TranslatableEntity } from './translate'

export interface BackfillOptions {
  entity?: TranslatableEntity
  locale?: string
  /** Most field-locale translations this run (default 60). */
  limit?: number
  /** Stop starting new records after this many milliseconds (default 20 s). */
  budgetMs?: number
  /** Stop starting new records once the provider was sent this many strings (default: no cap). */
  maxCalls?: number
  /** Override the configured provider (tests). null = no provider. */
  provider?: TranslationProvider | null
}

export interface BackfillResult {
  translated: number
  failed: number
  /** Still missing or stale (auto) after this run. */
  remaining: number
}

export async function runBackfill(db: Db, cfg: I18nConfig, opts: BackfillOptions = {}): Promise<BackfillResult> {
  const limit = opts.limit ?? 60
  const deadline = Date.now() + (opts.budgetMs ?? 20_000)
  const maxCalls = opts.maxCalls ?? Number.POSITIVE_INFINITY
  const provider = opts.provider !== undefined ? opts.provider : getProvider(cfg.provider)
  const result: BackfillResult = { translated: 0, failed: 0, remaining: 0 }
  // UI catalogs are never backfilled on a schedule, but an explicit request may name them.
  const entities = opts.entity ? [opts.entity] : CONTENT_ENTITIES
  const hash = hashMemo()
  let calls = 0
  const onCall = (strings: number) => {
    calls += strings
  }

  let budget = limit
  for (const entity of entities) {
    const { cells, sources } = await entityCells(db, cfg, entity, { locale: opts.locale, hash })
    const pending = cells.filter(needsAuto)
    if (!pending.length) continue
    const groups = new Map<string, { fields: Set<string>; locales: Set<string>; n: number }>()
    for (const c of pending) {
      const g = groups.get(c.entityId) ?? { fields: new Set(), locales: new Set(), n: 0 }
      g.fields.add(c.field)
      g.locales.add(c.locale)
      g.n++
      groups.set(c.entityId, g)
    }
    for (const [id, g] of groups) {
      if (!provider || budget <= 0 || calls >= maxCalls || Date.now() > deadline) {
        result.remaining += g.n
        continue
      }
      const src = sources.find((s) => s.id === id)
      if (!src) continue
      const fields = Object.fromEntries([...g.fields].map((f) => [f, src.fields[f]]))
      const r = await translateEntity(db, entity, id, fields, { config: cfg, provider, locales: [...g.locales], onCall, hash })
      result.translated += r.translated
      result.failed += r.failed
      result.remaining += r.failed
      budget -= g.n
    }
  }
  return result
}
