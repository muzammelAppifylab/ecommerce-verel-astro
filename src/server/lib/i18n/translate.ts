/* Content translations, write side (port of VAREL worker/lib/i18n/translate.ts + hooks.ts; docs/I18N.md).
   Source text lives on each record in the default locale; translations live in the Translation table keyed
   (entity, entityId, field, locale).
   - translateEntity: the engine (admin translations API, the backfill and the per-save job).
   - translateRecord: one record as stored, plus a product's colours (`option`) and a post's category
     (`post_category`): what VAREL's save hook did. Runs inside the `translations-backfill` job.
   - enqueueTranslation: the body of the `queueEntityTranslation` contract (src/server/lib/contracts.ts): after an
     admin save it sends ONE background job, so a save never waits on a provider (VAREL used waitUntil).
   Rules: manual rows (source=manual) are never overwritten by auto-translation; a row whose sourceHash differs
   from the current source is stale (auto: redone; manual: flagged for review).
   The read path (loadTranslations, tr, trJson, localizeRows) is F4's `./localize`; re-exported here so VAREL's
   import paths map one to one. */
import { Prisma } from '../../../generated/prisma/client'
import { config } from '../../../platform/config'
import { JobRejected, sendJob } from '../../../platform/background'
import type { Db } from '../db'
import type { TranslatableEntity } from './localize'
import { getProvider, providerNameOf, providerReady, type ProviderName, type TranslationProvider } from './providers'
import { isEntity, loadSources, normalizeSource } from './sources'
import { modeFor, translateValues, type BatchTranslator } from './structured'

export { loadTranslations, tr, trJson, type TranslatableEntity, type TranslationMap } from './localize'
export { normalizeSource } from './sources'
export { modeFor } from './structured'

/** The background list that runs translations (background.json, src/server/background.ts). */
export const TRANSLATION_LIST = 'translations-backfill'

/** Fingerprint of a source value: SHA-256 hex (first 16 chars) of the string, or of JSON.stringify for structured
    values. Used by the seed, auto-translation and staleness checks — never change the algorithm. */
export async function sourceHash(value: unknown): Promise<string> {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

/** sourceHash memoised for one request or run (a source value is hashed once, however many locales it has). */
export function hashMemo(): (value: unknown) => Promise<string> {
  const memo = new Map<string, Promise<string>>()
  return (value) => {
    const key = encodeValue(value)
    let p = memo.get(key)
    if (!p) {
      p = sourceHash(value)
      memo.set(key, p)
    }
    return p
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface I18nConfig {
  defaultLocale: string
  /** Enabled locales, default first. */
  locales: string[]
  provider: ProviderName
  autoTranslate: boolean
}

export const DEFAULT_I18N: I18nConfig = { defaultLocale: 'en', locales: ['en', 'da', 'de', 'fr', 'es', 'sv'], provider: 'workers-ai', autoTranslate: true }

export async function loadI18nConfig(db: Db): Promise<I18nConfig> {
  const s = await db.setting.findUnique({
    where: { id: 1 },
    select: { defaultLocale: true, locales: true, translationProvider: true, autoTranslate: true },
  })
  if (!s) return DEFAULT_I18N
  const def = s.defaultLocale || 'en'
  return {
    defaultLocale: def,
    locales: [def, ...s.locales.filter((l) => l !== def)],
    provider: providerNameOf(s.translationProvider),
    autoTranslate: s.autoTranslate,
  }
}

/** Locales that receive translations (every enabled one except the default). */
export const targetLocales = (cfg: I18nConfig) => cfg.locales.filter((l) => l !== cfg.defaultLocale)

// ─── Values ─────────────────────────────────────────────────────────────────

/** Stored form: text as is, structured values JSON-encoded. */
export const encodeValue = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/** A translator for one language pair, in provider-sized batches. `onCall` counts the strings sent. */
export function batchTranslator(provider: TranslationProvider, from: string, to: string, onCall?: (strings: number) => void): BatchTranslator {
  return async (texts) => {
    const out: string[] = []
    for (let i = 0; i < texts.length; i += provider.batchSize) {
      const batch = texts.slice(i, i + provider.batchSize)
      onCall?.(batch.length)
      out.push(...(await provider.translate(batch, from, to)))
    }
    return out
  }
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export interface TranslateOptions {
  /** Only these locales (default: every enabled target locale). */
  locales?: string[]
  /** Translate even when an up-to-date auto translation exists. */
  force?: boolean
  /** Replace manual translations too (admin "retranslate"). */
  overwriteManual?: boolean
  config?: I18nConfig
  /** Override the configured provider (tests, the backfill). null = no provider. */
  provider?: TranslationProvider | null
  /** Called with the number of strings each provider call carries (the backfill's call budget). */
  onCall?: (strings: number) => void
  /** A shared hash memo (the backfill passes one per run). */
  hash?: (value: unknown) => Promise<string>
}

export interface TranslateResult {
  translated: number
  failed: number
  skipped: number
}

export interface TranslationWrite {
  field: string
  value: string
  sourceHash: string
}

/** Upsert the auto translations of one record in one locale: ONE parameterised statement (VAREL: one upsert per row). */
export async function writeTranslations(db: Db, entity: string, entityId: string, locale: string, rows: TranslationWrite[]): Promise<number> {
  if (!rows.length) return 0
  const values = rows.map(
    (r) => Prisma.sql`(${entity}, ${entityId}, ${r.field}, ${locale}, ${r.value}, 'auto', ${r.sourceHash}, CURRENT_TIMESTAMP)`,
  )
  return db.$executeRaw`INSERT INTO "translations" ("entity", "entity_id", "field", "locale", "value", "source", "source_hash", "updated_at")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("entity", "entity_id", "field", "locale") DO UPDATE
    SET "value" = EXCLUDED."value", "source" = EXCLUDED."source", "source_hash" = EXCLUDED."source_hash", "updated_at" = CURRENT_TIMESTAMP`
}

/** Translate the given source fields of one record into the target locales, honouring the manual/stale rules.
    Fields with an empty source lose their auto translations. Never throws for provider errors (counted as failed). */
export async function translateEntity(
  db: Db,
  entity: TranslatableEntity,
  entityId: string,
  fields: Record<string, unknown>,
  opts: TranslateOptions = {},
): Promise<TranslateResult> {
  const result: TranslateResult = { translated: 0, failed: 0, skipped: 0 }
  const cfg = opts.config ?? (await loadI18nConfig(db))
  const provider = opts.provider !== undefined ? opts.provider : getProvider(cfg.provider)
  const locales = targetLocales(cfg).filter((l) => !opts.locales || opts.locales.includes(l))
  if (!locales.length) return result
  const hash = opts.hash ?? sourceHash

  const names = Object.keys(fields)
  if (!names.length) return result
  const existing = await db.translation.findMany({
    where: { entity, entityId, field: { in: names }, locale: { in: locales } },
    select: { field: true, locale: true, source: true, sourceHash: true },
  })
  const row = (field: string, locale: string) => existing.find((r) => r.field === field && r.locale === locale)

  const sources: { field: string; value: string | object; hash: string }[] = []
  const emptied: string[] = []
  for (const field of names) {
    const value = normalizeSource(fields[field])
    if (value == null) emptied.push(field)
    else sources.push({ field, value, hash: await hash(value) })
  }
  if (emptied.length) {
    await db.translation.deleteMany({ where: { entity, entityId, field: { in: emptied }, locale: { in: locales }, source: 'auto' } })
  }

  for (const locale of locales) {
    const todo = sources.filter((s) => {
      const r = row(s.field, locale)
      if (r?.source === 'manual' && !opts.overwriteManual) return false
      if (r && r.source === 'auto' && r.sourceHash === s.hash && !opts.force) return false
      return true
    })
    result.skipped += sources.length - todo.length
    if (!todo.length) continue
    if (!provider) {
      result.skipped += todo.length
      continue
    }
    try {
      const out = await translateValues(
        todo.map((s) => ({ value: s.value, mode: modeFor(entity, s.field) })),
        batchTranslator(provider, cfg.defaultLocale, locale, opts.onCall),
      )
      await writeTranslations(
        db,
        entity,
        entityId,
        locale,
        todo.map((s, i) => ({ field: s.field, value: encodeValue(out[i]), sourceHash: s.hash })),
      )
      result.translated += todo.length
    } catch (e) {
      result.failed += todo.length
      console.error(`[i18n] ${entity}:${entityId} → ${locale} failed:`, e instanceof Error ? e.message : e)
    }
  }
  return result
}

/** One saved record, as stored, into every enabled language (the per-save job; VAREL `queueEntityTranslation` in
    hooks.ts): its own fields, then (product) each distinct colour as `option`, (post) its category as
    `post_category`. Returns the summed result; `found: false` when the record is gone. */
export async function translateRecord(
  db: Db,
  entity: TranslatableEntity,
  id: string,
  opts: Pick<TranslateOptions, 'config' | 'provider'> = {},
): Promise<TranslateResult & { found: boolean }> {
  const total = { translated: 0, failed: 0, skipped: 0, found: false }
  const cfg = opts.config ?? (await loadI18nConfig(db))
  const provider = opts.provider !== undefined ? opts.provider : getProvider(cfg.provider)
  const hash = hashMemo()
  const add = (r: TranslateResult) => {
    total.translated += r.translated
    total.failed += r.failed
    total.skipped += r.skipped
  }
  const [src] = await loadSources(db, entity, [id])
  if (!src) return total
  total.found = true
  add(await translateEntity(db, entity, id, src.fields, { config: cfg, provider, hash }))
  if (entity === 'product') {
    const colors = await db.variant.findMany({ where: { productId: id, color: { not: null } }, select: { color: true }, distinct: ['color'], take: 100 })
    for (const { color } of colors) {
      if (color?.trim()) add(await translateEntity(db, 'option', color, { color }, { config: cfg, provider, hash }))
    }
  }
  if (entity === 'post') {
    const postId = Number(id)
    const p = Number.isInteger(postId) ? await db.post.findUnique({ where: { id: postId }, select: { category: true } }) : null
    if (p?.category.trim()) add(await translateEntity(db, 'post_category', p.category, { name: p.category }, { config: cfg, provider, hash }))
  }
  return total
}

/** The job data of a per-save translation. */
export interface TranslateRecordJob {
  entity: TranslatableEntity
  id: string
}

/** After an admin save: send one `translations-backfill` job for the record (the `queueEntityTranslation` contract).
    Skips when auto-translation is off or the provider is not set up (the hourly backfill and the admin cover it
    later). The job key carries the content hash: a double click sends one job, a second edit a new one. Never
    throws. Locally (and in the Preview) the job runs right away, in-process. */
export async function enqueueTranslation(
  db: Db,
  entity: string,
  id: string | number | null | undefined,
  opts: { requestUrl?: string } = {},
): Promise<void> {
  if (id === null || id === undefined || id === '' || !isEntity(entity) || entity === 'ui') return
  const entityId = String(id)
  try {
    const cfg = await loadI18nConfig(db)
    if (!cfg.autoTranslate || !providerReady(cfg.provider) || !targetLocales(cfg).length) return
    const requestUrl = opts.requestUrl ?? config.siteUrl
    if (!requestUrl) {
      console.warn(`[i18n] ${entity}:${entityId} not queued: no request URL (the hourly backfill picks it up)`)
      return
    }
    const [src] = await loadSources(db, entity, [entityId])
    if (!src) return
    const fingerprint = (await sourceHash(src.fields)).slice(0, 8)
    const data: TranslateRecordJob = { entity, id: entityId }
    await sendJob(requestUrl, TRANSLATION_LIST, data, {
      key: `tr-${entity}-${entityId}-${fingerprint}`.slice(0, 200),
      label: `Translate ${entity} ${entityId}`.slice(0, 120),
    })
  } catch (e) {
    if (e instanceof JobRejected) console.warn(`[i18n] ${entity}:${entityId} not queued (${e.code}); the hourly backfill picks it up`)
    else console.error(`[i18n] could not queue ${entity}:${entityId}`, e instanceof Error ? e.message : 'unknown error')
  }
}
