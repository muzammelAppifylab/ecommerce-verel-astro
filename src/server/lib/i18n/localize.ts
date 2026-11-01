/* Storefront read-path localisation (port of VAREL worker/lib/i18n/localize.ts + the read half of translate.ts):
   a per-request `Loc` (locale + server text + dates) and batch loaders that overlay Translation rows on catalog
   content. One query per entity type per request, never per row. Everything is optional: without a Loc (or for
   the default locale with no translations) output is the source text.
   PLAN.md F3 contract `localize(rows, entity, locale)` builds on `localizeRows` / `loadFor` / `tr` here (WP-25
   extends the write side: queueing, providers, backfill). Entity ids are strings in the Translation table:
   numeric ids are passed as they are and stringified here. */
import type { Context } from 'hono'
import type { Db } from '../db'
import { localeOf } from '../locale'
import { formatDate, formatMonthYear, serverT, type MessageVars, type Translator } from './messages'

export type TranslatableEntity =
  | 'product'
  | 'option' // colour names: entityId = the English value, e.g. "Camel"; field = "color"
  | 'department'
  | 'category'
  | 'post'
  | 'post_category' // entityId = English category name
  | 'page'
  | 'collection'
  | 'menu'
  | 'shipping_method'
  | 'discount'
  | 'email_template'
  | 'setting' // entityId = "1"
  | 'ui' // entityId = namespace, field = "catalog"; only for languages without a shipped catalog

/** key `${entityId}\u0000${field}` → translated value */
export type TranslationMap = Map<string, string>

export type EntityId = string | number
const k = (id: EntityId, field: string) => `${id}\u0000${field}`

export async function loadTranslations(
  db: Db,
  locale: string,
  defaultLocale: string,
  entity: TranslatableEntity,
  ids: EntityId[],
  fields?: string[],
): Promise<TranslationMap> {
  const map: TranslationMap = new Map()
  if (locale === defaultLocale || ids.length === 0) return map
  const rows = await db.translation.findMany({
    where: { entity, locale, entityId: { in: [...new Set(ids.map(String))] }, ...(fields ? { field: { in: fields } } : {}) },
    select: { entityId: true, field: true, value: true },
  })
  for (const r of rows) map.set(k(r.entityId, r.field), r.value)
  return map
}

/** Translated text or the source fallback. */
export const tr = (map: TranslationMap | undefined, id: EntityId, field: string, fallback: string): string =>
  map?.get(k(id, field)) ?? fallback

/** Translated structured value (JSON-encoded in the table) or the fallback. */
export function trJson<T>(map: TranslationMap | undefined, id: EntityId, field: string, fallback: T): T {
  const v = map?.get(k(id, field))
  if (v == null) return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export interface Loc {
  /** Request locale, e.g. "da". */
  locale: string
  /** Setting.defaultLocale: the language source text is written in. */
  defaultLocale: string
  /** Content overlays apply (locale differs from the default). */
  overlay: boolean
  t: Translator
  date: (d: Date) => string
  monthYear: (d: Date) => string
}

export function makeLoc(locale: string, defaultLocale = 'en'): Loc {
  return {
    locale,
    defaultLocale,
    overlay: locale !== defaultLocale,
    t: (key, vars?: MessageVars, fallback?: string) => serverT(locale, key, vars, fallback),
    date: (d) => formatDate(d, locale),
    monthYear: (d) => formatMonthYear(d, locale),
  }
}

/** English, no overlays: the default for every serializer. */
export const EN_LOC: Loc = makeLoc('en', 'en')

const perRequest = new WeakMap<Request, Promise<Loc>>()

/** The request's Loc (locale from `withLocale` / `localeOf`; Setting.defaultLocale read once per request). */
export function locOf(c: Context): Promise<Loc> {
  const key = c.req.raw
  let p = perRequest.get(key)
  if (!p) {
    const db = (c.get as (name: string) => unknown)('db') as Db | undefined
    p = localeOf(c).then(async (locale) => {
      if (!db) return makeLoc(locale, 'en')
      try {
        const s = await db.setting.findUnique({ where: { id: 1 }, select: { defaultLocale: true } })
        return makeLoc(locale, s?.defaultLocale || 'en')
      } catch {
        return makeLoc(locale, 'en')
      }
    })
    perRequest.set(key, p)
  }
  return p
}

/** loadTranslations for a Loc (empty map when no overlay applies). */
export function loadFor(db: Db, loc: Loc | undefined, entity: TranslatableEntity, ids: EntityId[], fields?: string[]): Promise<TranslationMap> {
  if (!loc?.overlay || !ids.length) return Promise.resolve(new Map())
  return loadTranslations(db, loc.locale, loc.defaultLocale, entity, ids, fields)
}

/** Overlay translated string fields on rows (the base of F3's `localize(rows, entity, locale)` contract): copies
    of the rows with each listed field replaced by its translation when one exists. `idOf` defaults to `row.id`. */
export async function localizeRows<R extends object>(
  db: Db,
  rows: R[],
  entity: TranslatableEntity,
  loc: Loc | undefined,
  fields: (keyof R & string)[],
  idOf: (row: R) => EntityId = (row) => (row as { id: EntityId }).id,
): Promise<R[]> {
  if (!loc?.overlay || !rows.length) return rows
  const m = await loadFor(db, loc, entity, rows.map(idOf), fields)
  if (!m.size) return rows
  return rows.map((row) => {
    const out = { ...row } as Record<string, unknown>
    for (const f of fields) {
      const v = out[f]
      if (typeof v === 'string') out[f] = tr(m, idOf(row), f, v)
    }
    return out as R
  })
}

// ─── Catalog bundle (products, categories, departments, colours) ────────────

export interface CatalogTr {
  product: TranslationMap
  category: TranslationMap
  department: TranslationMap
  option: TranslationMap
}

export interface CatalogRowLike {
  id: string
  categoryId: EntityId
  departmentId: EntityId
  variants?: { color: string | null }[]
}

/** Overlays for a set of products (plus their categories, departments and colour names): four queries at most. */
export async function loadCatalogTr(
  db: Db,
  loc: Loc | undefined,
  rows: CatalogRowLike[],
  extra: { categories?: EntityId[]; departments?: EntityId[]; colors?: string[] } = {},
): Promise<CatalogTr | undefined> {
  if (!loc?.overlay) return undefined
  const colors = [
    ...rows.flatMap((r) => (r.variants ?? []).map((v) => v.color).filter((c): c is string => !!c)),
    ...(extra.colors ?? []),
  ]
  const [product, category, department, option] = await Promise.all([
    loadFor(db, loc, 'product', rows.map((r) => r.id)),
    loadFor(db, loc, 'category', [...rows.map((r) => r.categoryId), ...(extra.categories ?? [])], ['name']),
    loadFor(db, loc, 'department', [...rows.map((r) => r.departmentId), ...(extra.departments ?? [])], ['name']),
    loadFor(db, loc, 'option', colors, ['color']),
  ])
  return { product, category, department, option }
}

/** Translated colour name (the English value stays the selection value). */
export const colorLabel = (t: CatalogTr | undefined, color: string | null): string | null =>
  color == null ? null : tr(t?.option, color, 'color', color)

// ─── F3 contract: localize(rows, entity, locale, fields?) ──────────────────

/** Storefront rows with their translatable string fields in `locale` (the base of `localize` in
    src/server/lib/contracts.ts, PLAN.md F3/F4): `fields` default to every field of `entity` (ENTITY_FIELDS);
    the store's default locale returns the rows unchanged. One bounded query for all rows. Never throws. */
export async function localize<R extends { id: string | number }>(
  rows: R[],
  entity: string,
  locale: string,
  fields?: readonly string[],
): Promise<R[]> {
  if (!rows.length || !locale) return rows
  try {
    const { getDb } = await import('../../../platform/db')
    const { localeSettings } = await import('../locale')
    const { ENTITY_FIELDS, isEntity } = await import('./sources')
    if (!isEntity(entity)) return rows
    const db = getDb()
    if (!db) return rows
    const { defaultLocale } = await localeSettings(db)
    const loc = makeLoc(locale, defaultLocale)
    const list = (fields ?? ENTITY_FIELDS[entity]) as (keyof R & string)[]
    return await localizeRows(db, rows, entity, loc, list)
  } catch (e) {
    console.error(`[i18n] could not localize ${entity}`, e instanceof Error ? e.message : 'unknown error')
    return rows
  }
}
