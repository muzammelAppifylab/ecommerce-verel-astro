/* Translation coverage (port of VAREL worker/lib/i18n/status.ts): for every source record × field × target locale,
   whether its translation is missing, stale (source changed since), auto or manual. Shared by the admin
   translations API and the backfill. Adds the list order (`compareCells`) and its keyset cursor (VAREL paged by
   offset). Sources are bounded by F4's `loadSources` (1000 records per entity). */
import { hasCatalogs } from '../../../lib/i18n/server'
import type { Db } from '../db'
import { decodeCursor, encodeCursor } from '../http'
import { ENTITIES, ENTITY_FIELDS, loadSources, type SourceRecord } from './sources'
import { encodeValue, sourceHash, targetLocales, type I18nConfig, type TranslatableEntity } from './translate'

export type CellStatus = 'missing' | 'stale' | 'auto' | 'manual'

export interface Cell {
  entity: TranslatableEntity
  entityId: string
  label: string
  field: string
  locale: string
  status: CellStatus
  /** auto | manual for existing rows */
  origin: 'auto' | 'manual' | null
  sourceValue: string
  value: string | null
  updatedAt: string | null
}

/** Target locales for an entity: UI catalogs only for languages without shipped catalogs. */
export const localesFor = (cfg: I18nConfig, entity: TranslatableEntity) =>
  targetLocales(cfg).filter((l) => entity !== 'ui' || !hasCatalogs(l))

export interface CellQuery {
  ids?: string[]
  locale?: string
  /** Include the source and translated values (lists and detail views). */
  withValues?: boolean
  /** A shared hash memo for the request. */
  hash?: (value: unknown) => Promise<string>
}

/** Every cell of one entity type. */
export async function entityCells(db: Db, cfg: I18nConfig, entity: TranslatableEntity, q: CellQuery = {}): Promise<{ cells: Cell[]; sources: SourceRecord[] }> {
  const locales = localesFor(cfg, entity).filter((l) => !q.locale || l === q.locale)
  if (!locales.length) return { cells: [], sources: [] }
  const [sources, rows] = await Promise.all([
    loadSources(db, entity, q.ids),
    db.translation.findMany({
      where: { entity, locale: { in: locales }, ...(q.ids ? { entityId: { in: q.ids } } : {}) },
      select: { entityId: true, field: true, locale: true, source: true, sourceHash: true, updatedAt: true, ...(q.withValues ? { value: true } : {}) },
    }),
  ])
  if (!sources.length) return { cells: [], sources }
  const hash = q.hash ?? sourceHash
  const byKey = new Map(rows.map((r) => [`${r.entityId}\u0000${r.field}\u0000${r.locale}`, r]))
  const cells: Cell[] = []
  for (const s of sources) {
    for (const field of ENTITY_FIELDS[entity]) {
      const v = s.fields[field]
      if (v == null) continue
      const h = await hash(v)
      const sourceValue = q.withValues ? encodeValue(v) : ''
      for (const locale of locales) {
        const r = byKey.get(`${s.id}\u0000${field}\u0000${locale}`)
        const origin = r ? (r.source === 'manual' ? 'manual' : 'auto') : null
        const status: CellStatus = !r ? 'missing' : r.sourceHash !== h ? 'stale' : (origin as 'auto' | 'manual')
        cells.push({
          entity,
          entityId: s.id,
          label: s.label,
          field,
          locale,
          status,
          origin,
          sourceValue,
          value: r && 'value' in r ? (r.value as string) : null,
          updatedAt: r ? r.updatedAt.toISOString() : null,
        })
      }
    }
  }
  return { cells, sources }
}

/** Cells the machine should (re)do: missing ones and stale auto ones. Manual ones are never touched. */
export const needsAuto = (c: Cell) => c.status === 'missing' || (c.status === 'stale' && c.origin === 'auto')

// ─── List order and keyset cursor ───────────────────────────────────────────

const ENTITY_ORDER = new Map(ENTITIES.map((e, i) => [e, i]))
const fieldIndex = (c: Pick<Cell, 'entity' | 'field'>) => ENTITY_FIELDS[c.entity].indexOf(c.field)

/** The sort key of a cell: entity order, label, record id, field order, locale order (VAREL's list sort). */
export type CellKey = [entity: number, label: string, entityId: string, field: number, locale: number]

/** Labels sort by their first 80 characters, so a cursor always fits the 512-character limit. */
export const cellKey = (c: Cell, cfg: I18nConfig): CellKey => [
  ENTITY_ORDER.get(c.entity) ?? 0,
  c.label.slice(0, 80),
  c.entityId,
  fieldIndex(c),
  cfg.locales.indexOf(c.locale),
]

export function compareKeys(a: CellKey, b: CellKey): number {
  return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3] - b[3] || a[4] - b[4]
}

export const compareCells = (cfg: I18nConfig) => (a: Cell, b: Cell) => compareKeys(cellKey(a, cfg), cellKey(b, cfg))

/** The cursor of the last cell on a page. */
export const cellCursor = (c: Cell, cfg: I18nConfig): string => encodeCursor(cellKey(c, cfg))

/** A cursor's key, or null when absent or malformed (a bad cursor starts from the top). */
export function decodeCellCursor(cursor: string | null | undefined): CellKey | null {
  const v = decodeCursor(cursor, 5)
  if (!v) return null
  const [e, label, id, f, l] = v
  if (typeof e !== 'number' || typeof label !== 'string' || typeof id !== 'string' || typeof f !== 'number' || typeof l !== 'number') return null
  return [e, label, id, f, l]
}

/** Cells strictly after the cursor (the list is sorted with `compareCells`). */
export const afterCursor = (cells: Cell[], after: CellKey | null, cfg: I18nConfig): Cell[] =>
  after ? cells.filter((c) => compareKeys(cellKey(c, cfg), after) > 0) : cells

export interface CellFilter {
  status?: CellStatus | ''
  q?: string
}

/** VAREL's list filters: missing/stale by status, auto/manual by origin (a stale manual row is "manual"); `q` matches
    the record label, the source, the translation, or the exact record id. */
export function filterCells(cells: Cell[], f: CellFilter): Cell[] {
  let out = cells
  if (f.status === 'missing' || f.status === 'stale') out = out.filter((x) => x.status === f.status)
  else if (f.status === 'auto' || f.status === 'manual') out = out.filter((x) => x.origin === f.status)
  if (f.q) {
    const q = f.q.toLowerCase()
    out = out.filter(
      (x) =>
        x.label.toLowerCase().includes(q) ||
        x.sourceValue.toLowerCase().includes(q) ||
        (x.value ?? '').toLowerCase().includes(q) ||
        x.entityId.toLowerCase() === q,
    )
  }
  return out
}
