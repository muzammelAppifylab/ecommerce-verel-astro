/* Staff activity log (port of VAREL worker/lib/activity.ts; docs/PHASE2-3.md §6). `activityLog` runs on every
   /site-api/manage request: after a successful mutation (POST/PATCH/PUT/DELETE, 2xx) it writes one ActivityLog row
   with a readable summary built from the route, the JSON body and the JSON response ("Updated product Atelier Wool
   Coat · price, stock"). Names for deletes are read before the handler runs. Logging never blocks or fails the
   request. The actor is the template viewer (`c.var.viewer`). WP-26 implements the F3 contract `recordActivity`
   on top of `logActivity` here and mounts `activityLog()` (PLAN.md §5). */
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Viewer } from '../../platform/types'
import type { Db } from './db'

export interface ActivityEntry {
  action: string // "product.update"
  entity: string // "product"
  entityId?: string | number | null
  summary: string
}

/** Who did it: the signed-in staff member (template `users`: id, name, email). */
export type Actor = { id: number; name: string | null; email: string | null }

export const actorName = (u: Actor) => u.name?.trim() || u.email || `User ${u.id}`

/** The request's actor from the template viewer, or null. */
export function actorOf(c: Context): Actor | null {
  const v = (c.get as (name: string) => unknown)('viewer') as Viewer | undefined
  return v?.state === 'user' && typeof v.id === 'number' ? { id: v.id, name: v.name, email: v.email } : null
}

/** Write one row. Never throws. */
export async function logActivity(db: Db, user: Actor | null, e: ActivityEntry): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        userId: user?.id ?? null,
        actorName: (user ? actorName(user) : 'System').slice(0, 120),
        action: e.action.slice(0, 60),
        entity: e.entity.slice(0, 40),
        entityId: e.entityId != null && e.entityId !== '' ? String(e.entityId).slice(0, 120) : null,
        summary: e.summary.replace(/\s+/g, ' ').trim().slice(0, 500),
      },
    })
  } catch (err) {
    console.error('[activity] could not write log', err instanceof Error ? err.message : 'unknown error')
  }
}

// ─── Entity names ───────────────────────────────────────────────────────────

type Row = Record<string, unknown>
const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
/** Admin paths that change nothing worth recording. */
const SKIP = new Set(['uploads', 'activity', 'activity.csv'])

const SINGULAR: Record<string, string> = {
  products: 'product',
  inventory: 'inventory',
  departments: 'department',
  categories: 'category',
  collections: 'collection',
  reviews: 'review',
  orders: 'order',
  returns: 'return',
  abandoned: 'cart',
  customers: 'customer',
  posts: 'post',
  pages: 'page',
  menus: 'menu',
  subscribers: 'subscriber',
  discounts: 'discount',
  shipping: 'shipping',
  settings: 'settings',
  'tax-rates': 'tax rate',
  emails: 'email',
  payments: 'payments',
  staff: 'staff',
}

/** First readable name on a row or response. */
function nameOf(o: unknown): string | null {
  if (!o || typeof o !== 'object') return null
  const r = o as Row
  if (typeof r.firstName === 'string' && typeof r.lastName === 'string') return `${r.firstName} ${r.lastName}`.trim() || null
  for (const k of ['name', 'title', 'number', 'zone', 'code', 'email', 'country', 'key', 'label']) {
    const v = r[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

type Finder = { findFirst(args: { where: Row; select?: Row; include?: Row }): Promise<unknown> }
const model = (db: Db, name: string) => (db as unknown as Record<string, Finder | undefined>)[name]

/** Integer primary keys (most models); string-keyed ones (products, variants, shipping) pass through. */
const intId = (s: string): number | null => (/^\d{1,9}$/.test(s) ? Number(s) : null)

/** Prisma model + lookup key per first path segment (deeper paths override). */
function lookupFor(segs: string[]): { model: string; where: Row } | null {
  const [a, b, c] = segs
  if (!b) return null
  const id = decodeURIComponent(b)
  const n = intId(id)
  const byInt = (m: string) => (n == null ? null : { model: m, where: { id: n } })
  switch (a) {
    case 'products':
      return { model: 'product', where: { id } }
    case 'departments':
      return byInt('department')
    case 'categories':
      return byInt('category')
    case 'collections':
      return byInt('collection')
    case 'reviews':
      return byInt('review')
    case 'customers':
      return byInt('user')
    case 'posts':
      return { model: 'post', where: { slug: id } }
    case 'pages':
      return byInt('page')
    case 'menus':
      return { model: 'menu', where: n == null ? { key: id } : { OR: [{ id: n }, { key: id }] } }
    case 'discounts':
      return byInt('discount')
    case 'tax-rates':
      return byInt('taxRate')
    case 'shipping':
      if (b === 'zones' && c) return { model: 'shippingZone', where: { id: decodeURIComponent(c) } }
      if (b === 'methods' && c) return { model: 'shippingMethod', where: { id: decodeURIComponent(c) } }
      return null
    case 'staff':
      return byInt('user')
    default:
      return null
  }
}

async function lookupName(db: Db, segs: string[]): Promise<string | null> {
  try {
    if (segs[0] === 'inventory' && segs[1]) {
      const v = await db.variant.findUnique({
        where: { id: decodeURIComponent(segs[1]) },
        select: { color: true, size: true, product: { select: { name: true } } },
      })
      return v ? [v.product.name, v.color, v.size].filter(Boolean).join(' · ') : null
    }
    const l = lookupFor(segs)
    if (!l) return null
    const m = model(db, l.model)
    const row = m ? ((await m.findFirst({ where: l.where })) as Row | null) : null
    if (row && segs[0] === 'tax-rates' && typeof row.country === 'string') return row.country
    if (row && segs[0] === 'reviews' && typeof row.title === 'string') return row.title
    return nameOf(row)
  } catch {
    return null
  }
}

// ─── Summaries ──────────────────────────────────────────────────────────────

const IGNORED_FIELDS = new Set(['id', 'slug', 'updatedAt', 'createdAt'])

/** "price, stock" — the JSON keys that were sent. */
function fieldList(body: Row, max = 6): string {
  const keys = Object.keys(body).filter((k) => !IGNORED_FIELDS.has(k))
  if (!keys.length) return ''
  return keys.length > max ? `${keys.slice(0, max).join(', ')} and ${keys.length - max} more` : keys.join(', ')
}

const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ')
const quoted = (s: string | null) => s ?? ''
const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : '')
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

interface DescribeInput {
  method: string
  segs: string[]
  body: Row
  result: Row | null
  pre: string | null
}

export function describe({ method, segs, body, result, pre }: DescribeInput): ActivityEntry | null {
  const [a = '', b, c, d] = segs
  if (!a || SKIP.has(a)) return null
  const entity = SINGULAR[a] ?? a.replace(/s$/, '')
  const verb = method === 'POST' ? 'Created' : method === 'DELETE' ? 'Deleted' : 'Updated'
  const op = method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update'
  const name = nameOf(result) ?? pre ?? nameOf(body)
  const id = b ? decodeURIComponent(b) : null
  const entry = (action: string, summary: string, entityId: string | null = id, ent = entity): ActivityEntry => ({
    action,
    entity: ent,
    entityId,
    summary,
  })

  switch (a) {
    case 'products': {
      if (b === 'order') return entry('product.reorder', `Reordered ${Array.isArray(body.productIds) ? body.productIds.length : ''} products in a category`.replace('  ', ' '), str(body.categoryId) || null)
      if (c === 'duplicate') return entry('product.duplicate', `Duplicated product ${quoted(pre)}${nameOf(result) ? ` as ${nameOf(result)}` : ''}`, nameOf(result) && result?.id ? String(result.id) : id)
      if (method === 'POST' && !b) return entry('product.create', `Created product ${quoted(nameOf(result) ?? nameOf(body))}`, result?.id ? String(result.id) : null)
      if (method === 'DELETE') return entry('product.delete', `Deleted product ${quoted(pre ?? id)}`)
      return entry(`product.${op}`, join(`Updated product ${quoted(name ?? id)}`, fieldList(body)))
    }
    case 'inventory': {
      if (b === 'bulk') {
        const n = Array.isArray(body.updates) ? body.updates.length : 0
        return entry('inventory.bulk', `Updated stock for ${n} ${n === 1 ? 'variant' : 'variants'}`, null)
      }
      const to = body.inventory !== undefined ? `set to ${str(body.inventory)}` : body.adjust !== undefined ? `adjusted by ${Number(body.adjust) > 0 ? '+' : ''}${str(body.adjust)}` : ''
      return entry('inventory.update', join(`Stock for ${quoted(pre ?? id)}`, to))
    }
    case 'departments': {
      if (c === 'categories') return entry('category.create', `Created category ${str(body.name)} in ${quoted(pre)}`, null, 'category')
      if (method === 'POST') return entry('department.create', `Created department ${quoted(name)}`, result?.id ? String(result.id) : null)
      return entry(`department.${op}`, method === 'DELETE' ? `Deleted department ${quoted(pre ?? id)}` : join(`Updated department ${quoted(name)}`, fieldList(body)))
    }
    case 'categories':
      return entry(`category.${op}`, method === 'DELETE' ? `Deleted category ${quoted(pre ?? id)}` : join(`Updated category ${quoted(name)}`, fieldList(body)))
    case 'orders': {
      const number = nameOf(result) ?? id
      if (c === 'refund') {
        const events = Array.isArray(result?.events) ? (result.events as Row[]) : []
        const amount = events.map((e) => /^Refunded (\S+)/.exec(str(e.message))?.[1]).find(Boolean)
        return entry('order.refund', join(`Refunded order ${number}`, amount, body.restock === true && 'restocked'), id)
      }
      if (method === 'PATCH' && !c) {
        const parts = [
          body.fulfillment && `marked ${lower(body.fulfillment)}`,
          !body.fulfillment && body.stage && `progress step ${str(body.stage)}`,
          (body.tracking !== undefined || body.carrier !== undefined) && `tracking ${[str(body.carrier), str(body.tracking)].filter(Boolean).join(' ') || 'removed'}`,
          body.payment && `payment ${lower(body.payment)}`,
          body.note !== undefined && 'note updated',
        ].filter(Boolean) as string[]
        return entry('order.update', join(`Updated order ${number}`, parts.join(', ')))
      }
      return entry(`order.${op}`, join(`${verb} order ${number}`, c))
    }
    case 'returns': {
      const order = result && typeof result.order === 'object' ? nameOf(result.order) : null
      return entry('return.update', join(`Updated return${order ? ` for order ${order}` : ''}`, body.status ? `marked ${lower(body.status)}` : null, body.note !== undefined && 'note updated'))
    }
    case 'customers': {
      if (method === 'PATCH' && body.role) return entry('customer.role', `Changed role for ${quoted(name ?? id)} to ${str(body.role)}`)
      if (method === 'DELETE') return entry('customer.delete', `Deleted customer ${quoted(pre ?? id)}`)
      return entry(`customer.${op}`, join(`${verb} customer ${quoted(name ?? id)}`, c))
    }
    case 'posts': {
      if (method === 'POST' && !b) return entry('post.create', `Created post ${quoted(name)}`, str(result?.slug) || null)
      if (method === 'DELETE') return entry('post.delete', `Deleted post ${quoted(pre ?? id)}`)
      if (body.status === 'published') return entry('post.publish', `Published post ${quoted(name)}`)
      return entry('post.update', join(`Updated post ${quoted(name ?? id)}`, fieldList(body)))
    }
    case 'subscribers':
      return entry('subscriber.delete', `Removed subscriber ${id ?? ''}`)
    case 'discounts': {
      if (c === 'codes') {
        const n = Number(body.count) || 0
        return method === 'DELETE'
          ? entry('discount.codes.delete', `Deleted unused codes for discount ${quoted(pre)}`)
          : entry('discount.codes.create', `Generated ${n} ${n === 1 ? 'code' : 'codes'} for discount ${quoted(pre)}`)
      }
      if (method === 'POST' && !b) return entry('discount.create', `Created discount ${quoted(name)}`, result?.id ? String(result.id) : null)
      if (method === 'DELETE') return entry('discount.delete', `Deleted discount ${quoted(pre ?? id)}`)
      if (b && !c) return entry('discount.update', join(`Updated discount ${quoted(name ?? id)}`, fieldList(body)))
      return entry(`discount.${op}`, join(`${verb} discounts`, b, c), null)
    }
    case 'shipping': {
      const sub = b === 'methods' || d === 'methods' ? 'method' : 'zone'
      const sid = c ? decodeURIComponent(c) : null
      if (b === 'zones' && d === 'methods') return entry('shipping.method.create', `Added shipping method ${str(body.name)} to ${quoted(pre)}`, sid, 'shipping')
      if (method === 'POST') return entry(`shipping.${sub}.create`, `Created shipping ${sub} ${quoted(name)}`, result?.id ? String(result.id) : null, 'shipping')
      if (method === 'DELETE') return entry(`shipping.${sub}.delete`, `Deleted shipping ${sub} ${quoted(pre ?? sid)}`, sid, 'shipping')
      return entry(`shipping.${sub}.update`, join(`Updated shipping ${sub} ${quoted(name ?? sid)}`, fieldList(body)), sid, 'shipping')
    }
    case 'settings':
      return entry('settings.update', join('Changed settings', fieldList(body, 8)), null)
    case 'tax-rates': {
      const country = (result && str(result.country)) || pre || str(body.country) || null
      const name = country
      const rate = typeof body.rate === 'number' ? `${Math.round(body.rate * 10000) / 100}%` : null
      if (method === 'POST') return entry('taxRate.create', join(`Added tax rate for ${quoted(name)}`, rate), result?.id ? String(result.id) : null)
      if (method === 'DELETE') return entry('taxRate.delete', `Deleted tax rate for ${quoted(pre ?? id)}`)
      return entry('taxRate.update', join(`Updated tax rate for ${quoted(name ?? id)}`, rate ?? fieldList(body)))
    }
    case 'staff': {
      if (b === 'invites') {
        const inviteId = c ? decodeURIComponent(c) : null
        if (d === 'resend') return entry('staff.invite.resend', `Resent staff invite to ${quoted(pre)}`, inviteId)
        if (method === 'DELETE') return entry('staff.invite.revoke', `Revoked staff invite for ${quoted(pre)}`, inviteId)
        const areas = Array.isArray(body.permissions) && body.permissions.length ? (body.permissions as string[]).join(', ') : 'all areas'
        const invite = result && typeof result.invite === 'object' ? (result.invite as Row) : null
        return entry('staff.invite', join(`Invited ${str(body.email).toLowerCase()} as ${str(body.role) || 'staff'}`, body.role === 'admin' ? null : areas), invite?.id ? String(invite.id) : null)
      }
      if (method === 'DELETE') return entry('staff.remove', `Removed staff access for ${quoted(pre ?? id)}`)
      const areas = Array.isArray(body.permissions) ? (body.permissions.length ? (body.permissions as string[]).join(', ') : 'all areas') : null
      return entry('staff.update', join(`Changed access for ${quoted(name ?? id)}`, body.role ? `role ${str(body.role)}` : null, areas))
    }
    case 'emails': {
      const key = c ? decodeURIComponent(c) : null
      if (b === 'templates' && d === 'preview') return null
      if (b === 'templates' && d === 'test') return entry('email.test', `Sent a test ${quoted(key)} email${body.to ? ` to ${str(body.to)}` : ''}`, key, 'email')
      if (b === 'templates' && d === 'reset') return entry('email.template.reset', `Reset email template ${quoted(key)} to the default`, key, 'email')
      if (b === 'templates' && key) return entry('email.template.update', join(`Updated email template ${quoted(key)}`, fieldList(body)), key, 'email')
      if (b === 'messages' && d === 'resend') return entry('email.resend', `Resent email${nameOf(result) ? ` to ${nameOf(result)}` : ''}`, key, 'email')
      return entry(`email.${op}`, join(`${verb} email`, b, d), key, 'email')
    }
    case 'abandoned': {
      if (b === 'run') return entry('cart.reminders.run', 'Ran abandoned bag reminders now', null, 'cart')
      if (c === 'remind') return entry('cart.remind', `Sent an abandoned bag reminder${nameOf(result) ? ` to ${nameOf(result)}` : ''}`, id, 'cart')
      return entry(`cart.${op}`, `${verb} abandoned bag`, id, 'cart')
    }
    case 'reviews': {
      if (b === 'bulk') {
        const n = Array.isArray(body.ids) ? body.ids.length : 0
        return entry('review.bulk', join(`Updated ${n} ${n === 1 ? 'review' : 'reviews'}`, body.status ? `marked ${lower(body.status)}` : str(body.action)), null)
      }
      const title = pre ?? name
      if (method === 'DELETE') return entry('review.delete', `Deleted review ${quoted(title ?? id)}`)
      if (body.status) return entry('review.moderate', `Marked review ${quoted(title)} ${lower(body.status)}`)
      if (body.reply !== undefined) return entry('review.reply', `Replied to review ${quoted(title)}`)
      return entry('review.update', join(`Updated review ${quoted(title)}`, fieldList(body)))
    }
    case 'collections':
      if (b === 'order') return entry('collection.reorder', 'Reordered collections', null)
      if (method === 'POST' && !b) return entry('collection.create', `Created collection ${quoted(name)}`, result?.id ? String(result.id) : null)
      if (method === 'DELETE') return entry('collection.delete', `Deleted collection ${quoted(pre ?? id)}`)
      return entry('collection.update', join(`Updated collection ${quoted(name ?? id)}`, fieldList(body)))
    default: {
      // Routers added later (collections, pages, menus, reviews, emails, abandoned, payments…)
      const label = entity
      if (method === 'POST' && !b) return entry(`${a}.create`, join(`Created ${label}`, name), result?.id ? String(result.id) : null)
      if (method === 'DELETE') return entry(`${a}.delete`, join(`Deleted ${label}`, pre ?? name ?? id), id)
      if (b && !c && /^[a-z][a-z-]{1,18}$/.test(b) && method === 'POST') return entry(`${a}.${b.replace(/-/g, '_')}`, join(`${b[0]!.toUpperCase()}${b.slice(1).replace(/-/g, ' ')} · ${label}`, name), null)
      const tail = segs.slice(2).filter((s) => !/^[a-z0-9]{20,}$/i.test(s)).join(' ')
      return entry(`${a}.${tail ? tail.replace(/\W+/g, '_') : op}`, join(`${tail ? `${tail[0]!.toUpperCase()}${tail.slice(1)}` : verb} ${label}`.trim(), name ?? (b && b !== tail ? id : null), !tail && method !== 'POST' ? fieldList(body) : null), id)
    }
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────

type Row2 = Row

async function readBody(c: Context): Promise<Row2> {
  try {
    if (!/json/i.test(c.req.header('Content-Type') ?? '')) return {}
    const text = await c.req.text() // cached by Hono, so handlers can still read it
    const v = text.trim() ? JSON.parse(text) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row2) : {}
  } catch {
    return {}
  }
}

async function readResult(res: Response): Promise<Row2 | null> {
  try {
    if (!/json/i.test(res.headers.get('Content-Type') ?? '')) return null
    const v = await res.clone().json()
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row2) : null
  } catch {
    return null
  }
}

/** Mount on /site-api/manage after the auth and permission checks and `withDb`. `base` is the mount prefix to strip. */
export const activityLog = (base = '/site-api/manage') =>
  createMiddleware(async (c, next) => {
    const method = c.req.method.toUpperCase()
    const path = c.req.path.startsWith(base) ? c.req.path.slice(base.length) : c.req.path
    const segs = path.split('/').filter(Boolean)
    if (!MUTATIONS.has(method) || !segs.length || SKIP.has(segs[0]!)) return next()
    const db = (c.get as (name: string) => unknown)('db') as Db | undefined
    if (!db) return next()

    let body: Row2 = {}
    let pre: string | null = null
    try {
      body = await readBody(c)
      // Names that are gone (or changing) after the handler runs.
      const needsPre = method === 'DELETE' || segs[0] === 'inventory' || segs[0] === 'reviews' || segs.length > 2
      if (needsPre) pre = await lookupName(db, segs)
    } catch {
      /* never block the request */
    }

    await next()

    try {
      if (c.res.status >= 300 || c.error) return
      const result = await readResult(c.res)
      const e = describe({ method, segs, body, result, pre })
      if (e) await logActivity(db, actorOf(c), e)
    } catch (err) {
      console.error('[activity] skipped', err instanceof Error ? err.message : 'unknown error')
    }
  })
