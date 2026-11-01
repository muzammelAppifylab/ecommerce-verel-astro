/* Source values of every translatable record (port of VAREL worker/lib/i18n/sources.ts; docs/I18N.md
   "Translation table"), read from the database so structured values hash exactly as they are stored. Used by the
   admin translations API (coverage, lists, one record) and the backfill job (WP-25).
   Differences: numeric ids are returned as strings (Translation.entityId); email templates are read from the
   `email_templates` rows (the seed writes every default; WP-22 owns the defaults table); UI catalogs come from
   src/locales via src/lib/i18n/server.ts. */
import type { Db } from '../db'
import { catalog, NAMESPACES } from '../../../lib/i18n/server'
import type { TranslatableEntity } from './localize'

export interface SourceRecord {
  id: string
  /** Human name for the admin, e.g. the product name */
  label: string
  /** field → source value (null when empty: nothing to translate) */
  fields: Record<string, string | object | null>
}

/** Fields per entity, in the order the admin shows them. */
export const ENTITY_FIELDS: Record<TranslatableEntity, string[]> = {
  product: ['name', 'short', 'description', 'material', 'care'],
  option: ['color'],
  department: ['name'],
  category: ['name'],
  post: ['title', 'excerpt', 'body', 'seoTitle', 'seoDescription'],
  post_category: ['name'],
  page: ['title', 'body', 'seoTitle', 'seoDescription'],
  collection: ['title', 'description', 'seoTitle', 'seoDescription'],
  menu: ['items'],
  shipping_method: ['name', 'detail'],
  discount: ['name', 'label', 'note'],
  email_template: ['subject', 'body'],
  setting: ['announcement', 'termsText', 'returnReasons', 'homeHero', 'seoTitle', 'seoDescription'],
  ui: ['catalog'],
}

export const ENTITIES = Object.keys(ENTITY_FIELDS) as TranslatableEntity[]
export const CONTENT_ENTITIES = ENTITIES.filter((e) => e !== 'ui')

export const isEntity = (e: string): e is TranslatableEntity => Object.hasOwn(ENTITY_FIELDS, e)

/** Fields whose value is JSON (structured). */
export const isJsonField = (entity: string, field: string) =>
  (entity === 'post' || entity === 'page') && field === 'body'
    ? true
    : (entity === 'menu' && field === 'items') || (entity === 'setting' && (field === 'returnReasons' || field === 'homeHero')) || entity === 'ui'

/** The source value to translate, or null when there is nothing (empty text, [], {}). */
export function normalizeSource(v: unknown): string | object | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() ? v : null
  if (Array.isArray(v)) return v.length ? v : null
  if (typeof v === 'object') return Object.keys(v as object).length ? (v as object) : null
  return String(v)
}

const rec = (id: string | number, label: string, fields: Record<string, unknown>): SourceRecord => ({
  id: String(id),
  label,
  fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, normalizeSource(v)])),
})

/** Customer-facing email templates (staff alerts and invites stay in the admin language). */
export const CUSTOMER_TEMPLATES = [
  'order_confirmation',
  'order_shipped',
  'order_delivered',
  'order_refunded',
  'return_update',
  'password_reset',
  'welcome',
  'abandoned_cart',
  'account_deleted',
]

/** Most records listed per entity (bounded; the admin pages through ids for more). */
const SOURCE_LIMIT = 1000

const intIds = (ids: string[]) => ids.map(Number).filter((n) => Number.isInteger(n))

/** Source records of one entity type (optionally only some ids). */
export async function loadSources(db: Db, entity: TranslatableEntity, ids?: string[]): Promise<SourceRecord[]> {
  const strIn = ids ? { in: ids } : undefined
  const intIn = ids ? { in: intIds(ids) } : undefined
  const take = SOURCE_LIMIT
  switch (entity) {
    case 'product': {
      const rows = await db.product.findMany({
        where: { ...(strIn ? { id: strIn } : { status: { not: 'archived' } }) },
        select: { id: true, name: true, short: true, description: true, material: true, care: true },
        orderBy: { name: 'asc' },
        take,
      })
      return rows.map((r) => rec(r.id, r.name, { name: r.name, short: r.short, description: r.description, material: r.material, care: r.care }))
    }
    case 'option': {
      const rows = await db.variant.findMany({
        where: { color: strIn ?? { not: null } },
        select: { color: true },
        distinct: ['color'],
        orderBy: { color: 'asc' },
        take,
      })
      return rows.filter((r) => r.color && r.color.trim()).map((r) => rec(r.color!, r.color!, { color: r.color }))
    }
    case 'department': {
      const rows = await db.department.findMany({ where: intIn ? { id: intIn } : {}, orderBy: { position: 'asc' }, take })
      return rows.map((r) => rec(r.id, r.name, { name: r.name }))
    }
    case 'category': {
      const rows = await db.category.findMany({
        where: intIn ? { id: intIn } : {},
        include: { department: { select: { name: true } } },
        orderBy: [{ department: { position: 'asc' } }, { position: 'asc' }],
        take,
      })
      return rows.map((r) => rec(r.id, `${r.department.name} · ${r.name}`, { name: r.name }))
    }
    case 'post': {
      const rows = await db.post.findMany({
        where: intIn ? { id: intIn } : {},
        select: { id: true, title: true, excerpt: true, body: true, seoTitle: true, seoDescription: true },
        orderBy: { createdAt: 'desc' },
        take,
      })
      return rows.map((r) => rec(r.id, r.title, { title: r.title, excerpt: r.excerpt, body: r.body, seoTitle: r.seoTitle, seoDescription: r.seoDescription }))
    }
    case 'post_category': {
      const rows = await db.post.findMany({ where: { category: strIn ?? { not: '' } }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' }, take })
      return rows.map((r) => rec(r.category, r.category, { name: r.category }))
    }
    case 'page': {
      const rows = await db.page.findMany({ where: intIn ? { id: intIn } : {}, orderBy: { title: 'asc' }, take })
      return rows.map((r) => rec(r.id, r.title, { title: r.title, body: r.body, seoTitle: r.seoTitle, seoDescription: r.seoDescription }))
    }
    case 'collection': {
      const rows = await db.collection.findMany({ where: intIn ? { id: intIn } : {}, orderBy: { position: 'asc' }, take })
      return rows.map((r) => rec(r.id, r.title, { title: r.title, description: r.description, seoTitle: r.seoTitle, seoDescription: r.seoDescription }))
    }
    case 'menu': {
      const rows = await db.menu.findMany({ where: intIn ? { id: intIn } : {}, orderBy: { key: 'asc' }, take })
      return rows.map((r) => rec(r.id, r.title || r.key, { items: r.items }))
    }
    case 'shipping_method': {
      const rows = await db.shippingMethod.findMany({
        where: strIn ? { id: strIn } : {},
        include: { zone: { select: { name: true, position: true } } },
        orderBy: [{ zone: { position: 'asc' } }, { position: 'asc' }],
        take,
      })
      return rows.map((r) => rec(r.id, `${r.zone.name} · ${r.name}`, { name: r.name, detail: r.detail }))
    }
    case 'discount': {
      const rows = await db.discount.findMany({ where: intIn ? { id: intIn } : {}, orderBy: { createdAt: 'desc' }, take })
      return rows.map((r) => rec(r.id, r.code || r.name || r.label, { name: r.name, label: r.label, note: r.note }))
    }
    case 'email_template': {
      const keys = CUSTOMER_TEMPLATES.filter((key) => !ids || ids.includes(key))
      const rows = await db.emailTemplate.findMany({ where: { key: { in: keys } }, select: { key: true, subject: true, body: true } })
      return keys.flatMap((key) => {
        const row = rows.find((r) => r.key === key)
        return row ? [rec(key, key.replace(/_/g, ' '), { subject: row.subject, body: row.body })] : []
      })
    }
    case 'setting': {
      if (ids && !ids.includes('1')) return []
      const s = await db.setting.findUnique({ where: { id: 1 } })
      if (!s) return []
      return [
        rec('1', 'Store texts', {
          announcement: s.announcement,
          termsText: s.termsText,
          returnReasons: s.returnReasons,
          homeHero: s.homeHero,
          seoTitle: s.seoTitle,
          seoDescription: s.seoDescription,
        }),
      ]
    }
    case 'ui': {
      return NAMESPACES.filter((ns) => !ids || ids.includes(ns)).map((ns) => rec(ns, `Interface · ${ns}`, { catalog: catalog('en', ns) }))
    }
  }
}
