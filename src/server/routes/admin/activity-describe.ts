/* The store activity log's describer and middleware (port of VAREL worker/lib/activity.ts; docs/PHASE2-3.md §6).

   `activityLogMiddleware(base)` runs on every /site-api/manage request (mounted once in ./index.ts through the
   `activityLog` contract, src/server/lib/contracts.ts): after a successful write (POST/PATCH/PUT/DELETE, 2xx) it
   writes one `activity_logs` row with a readable summary built from the route, the JSON body and the JSON response
   ("Updated product Atelier Wool Coat · price, stock"). Names that are gone (or changing) after the handler runs
   are read BEFORE it, with explicit selects of display fields only. Logging never blocks or fails the request.

   Differences from F4's src/server/lib/activity.ts copy (kept there for `logActivity`, `actorName`, `actorOf`):
   - the database comes from `getDb()` (request-scoped), because `withDb` runs per handler, after `.use`;
   - the paths are the ones this app mounts (`/manage/taxonomy/…`, `collections/product-order`, `staff/invite`,
     `abandoned/bulk`), and the VAREL staff-invite cases are replaced by the template-role ones;
   - every lookup selects only the fields it shows (never a whole `users` row). */
import type {Context, MiddlewareHandler} from 'hono';
import {createMiddleware} from 'hono/factory';

import {getDb} from '../../../platform/db';
import type {Db} from '../../lib/contracts';
import {type ActivityEntry, actorOf, logActivity} from '../../lib/activity';

type Row = Record<string, unknown>;

const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/** Admin paths that change nothing worth recording. */
const SKIP = new Set(['uploads', 'activity']);

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
  translations: 'translation',
};

/** The path under the manage base as segments, with `/taxonomy` stripped (VAREL had departments/categories at the top). */
export function segmentsOf(path: string, base = '/site-api/manage'): string[] {
  const rest = path.startsWith(base) ? path.slice(base.length) : path;
  const segs = rest.split('/').filter(Boolean);
  return segs[0] === 'taxonomy' ? segs.slice(1) : segs;
}

/** First readable name on a row or response. */
export function nameOf(o: unknown): string | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Row;
  if (typeof r.firstName === 'string' && typeof r.lastName === 'string') return `${r.firstName} ${r.lastName}`.trim() || null;
  for (const k of ['name', 'title', 'number', 'zone', 'code', 'email', 'country', 'key', 'label']) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Int primary keys (most models); a non-numeric id means no lookup. */
const intId = (s: string): number | null => (/^\d{1,9}$/.test(s) ? Number(s) : null);

const userName = (u: {name: string; email: string} | null) => (u ? u.name.trim() || u.email : null);

/**
 * The display name of the record a path points at, read before the handler runs (deletes, and anything whose
 * name may change). Explicit selects only. Never throws.
 */
export async function lookupName(db: Db, segs: string[]): Promise<string | null> {
  const [a, b, c] = segs;
  if (!b) return null;
  try {
    const id = decodeURIComponent(b);
    const n = intId(id);
    switch (a) {
      case 'products': {
        if (b === 'order') return null;
        const p = await db.product.findUnique({where: {id}, select: {name: true}});
        return p?.name ?? null;
      }
      case 'inventory': {
        if (b === 'bulk') return null;
        const v = await db.variant.findUnique({where: {id}, select: {color: true, size: true, product: {select: {name: true}}}});
        return v ? [v.product.name, v.color, v.size].filter(Boolean).join(' · ') : null;
      }
      case 'departments':
        return n == null ? null : ((await db.department.findUnique({where: {id: n}, select: {name: true}}))?.name ?? null);
      case 'categories':
        return n == null ? null : ((await db.category.findUnique({where: {id: n}, select: {name: true}}))?.name ?? null);
      case 'collections':
        return n == null ? null : ((await db.collection.findUnique({where: {id: n}, select: {title: true}}))?.title ?? null);
      case 'reviews':
        return n == null ? null : ((await db.review.findUnique({where: {id: n}, select: {title: true}}))?.title ?? null);
      case 'customers':
      case 'staff':
        return n == null ? null : userName(await db.user.findUnique({where: {id: n}, select: {name: true, email: true}}));
      case 'posts':
        return (await db.post.findUnique({where: {slug: id}, select: {title: true}}))?.title ?? null;
      case 'pages':
        return n == null ? null : ((await db.page.findUnique({where: {id: n}, select: {title: true}}))?.title ?? null);
      case 'menus': {
        const m = await db.menu.findFirst({where: n == null ? {key: id} : {OR: [{id: n}, {key: id}]}, select: {title: true, key: true}});
        return m ? m.title || m.key : null;
      }
      case 'discounts': {
        if (n == null) return null;
        const d = await db.discount.findUnique({where: {id: n}, select: {name: true, code: true, label: true}});
        return d ? d.name || d.code || d.label || null : null;
      }
      case 'tax-rates':
        return n == null ? null : ((await db.taxRate.findUnique({where: {id: n}, select: {country: true}}))?.country ?? null);
      case 'shipping':
        if (b === 'zones' && c) return (await db.shippingZone.findUnique({where: {id: decodeURIComponent(c)}, select: {name: true}}))?.name ?? null;
        if (b === 'methods' && c) return (await db.shippingMethod.findUnique({where: {id: decodeURIComponent(c)}, select: {name: true}}))?.name ?? null;
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── Summaries ──────────────────────────────────────────────────────────────

const IGNORED_FIELDS = new Set(['id', 'slug', 'updatedAt', 'createdAt']);

/** "price, stock": the JSON keys that were sent. */
export function fieldList(body: Row, max = 6): string {
  const keys = Object.keys(body).filter(k => !IGNORED_FIELDS.has(k));
  if (!keys.length) return '';
  return keys.length > max ? `${keys.slice(0, max).join(', ')} and ${keys.length - max} more` : keys.join(', ');
}

const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const quoted = (s: string | null) => s ?? '';
const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : '');
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

export interface DescribeInput {
  method: string;
  /** Path segments under `/site-api/manage`, `taxonomy` already stripped (`segmentsOf`). */
  segs: string[];
  body: Row;
  result: Row | null;
  pre: string | null;
}

/** One activity row for a successful admin write, or null when it is not worth recording. */
export function describe({method, segs, body, result, pre}: DescribeInput): ActivityEntry | null {
  const [a = '', b, c, d] = segs;
  if (!a || SKIP.has(a)) return null;
  const entity = SINGULAR[a] ?? a.replace(/s$/, '');
  const verb = method === 'POST' ? 'Created' : method === 'DELETE' ? 'Deleted' : 'Updated';
  const op = method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update';
  const name = nameOf(result) ?? pre ?? nameOf(body);
  const id = b ? decodeURIComponent(b) : null;
  const entry = (action: string, summary: string, entityId: string | null = id, ent = entity): ActivityEntry => ({
    action,
    entity: ent,
    entityId,
    summary,
  });
  const reorderProducts = (category: unknown) =>
    entry('product.reorder', `Reordered ${count(body.productIds) || ''} products in a category`.replace('  ', ' '), str(category) || null, 'product');

  switch (a) {
    case 'products': {
      if (b === 'order') return reorderProducts(body.categoryId ?? body.category);
      if (c === 'duplicate') return entry('product.duplicate', `Duplicated product ${quoted(pre)}${nameOf(result) ? ` as ${nameOf(result)}` : ''}`, nameOf(result) && result?.id ? String(result.id) : id);
      if (method === 'POST' && !b) return entry('product.create', `Created product ${quoted(nameOf(result) ?? nameOf(body))}`, result?.id ? String(result.id) : null);
      if (method === 'DELETE') {
        if (result?.archived === true) return entry('product.archive', `Archived product ${quoted(pre ?? id)} (it has orders)`);
        return entry('product.delete', `Deleted product ${quoted(pre ?? id)}`);
      }
      return entry(`product.${op}`, join(`Updated product ${quoted(name ?? id)}`, fieldList(body)));
    }
    case 'inventory': {
      if (b === 'bulk') {
        const n = count(body.updates);
        return entry('inventory.bulk', `Updated stock for ${n} ${n === 1 ? 'variant' : 'variants'}`, null);
      }
      const to =
        body.inventory !== undefined
          ? `set to ${str(body.inventory)}`
          : body.adjust !== undefined
            ? `adjusted by ${Number(body.adjust) > 0 ? '+' : ''}${str(body.adjust)}`
            : '';
      return entry('inventory.update', join(`Stock for ${quoted(pre ?? id)}`, to));
    }
    case 'departments': {
      if (c === 'categories') return entry('category.create', `Created category ${str(body.name)} in ${quoted(pre)}`, null, 'category');
      if (method === 'POST' && !b) return entry('department.create', `Created department ${quoted(name)}`, result?.id ? String(result.id) : null);
      if (b === 'order') return entry('department.reorder', 'Reordered departments', null);
      return entry(`department.${op}`, method === 'DELETE' ? `Deleted department ${quoted(pre ?? id)}` : join(`Updated department ${quoted(name)}`, fieldList(body)));
    }
    case 'categories':
      if (method === 'POST' && !b) return entry('category.create', `Created category ${quoted(name)}`, result?.id ? String(result.id) : null);
      return entry(`category.${op}`, method === 'DELETE' ? `Deleted category ${quoted(pre ?? id)}` : join(`Updated category ${quoted(name)}`, fieldList(body)));
    case 'orders': {
      const number = nameOf(result) ?? id;
      if (c === 'refund') {
        const events = Array.isArray(result?.events) ? (result.events as Row[]) : [];
        const amount = events.map(e => /^Refunded (\S+)/.exec(str(e.message))?.[1]).find(Boolean);
        return entry('order.refund', join(`Refunded order ${number}`, amount, body.restock === true && 'restocked'), id);
      }
      if (method === 'PATCH' && !c) {
        const parts = [
          body.fulfillment && `marked ${lower(body.fulfillment)}`,
          !body.fulfillment && body.stage && `progress step ${str(body.stage)}`,
          (body.tracking !== undefined || body.carrier !== undefined) && `tracking ${[str(body.carrier), str(body.tracking)].filter(Boolean).join(' ') || 'removed'}`,
          body.payment && `payment ${lower(body.payment)}`,
          body.note !== undefined && 'note updated',
        ].filter(Boolean) as string[];
        return entry('order.update', join(`Updated order ${number}`, parts.join(', ')));
      }
      return entry(`order.${op}`, join(`${verb} order ${number}`, c));
    }
    case 'returns': {
      const order = result && typeof result.order === 'object' ? nameOf(result.order) : null;
      return entry('return.update', join(`Updated return${order ? ` for order ${order}` : ''}`, body.status ? `marked ${lower(body.status)}` : null, body.note !== undefined && 'note updated'));
    }
    case 'customers': {
      if (method === 'PATCH' && body.role) return entry('customer.role', `Changed role for ${quoted(name ?? id)} to ${str(body.role)}`);
      if (method === 'DELETE') return entry('customer.delete', `Deleted customer ${quoted(pre ?? id)}`);
      return entry(`customer.${op}`, join(`${verb} customer ${quoted(name ?? id)}`, c));
    }
    case 'posts': {
      if (method === 'POST' && !b) return entry('post.create', `Created post ${quoted(name)}`, str(result?.slug) || null);
      if (method === 'DELETE') return entry('post.delete', `Deleted post ${quoted(pre ?? id)}`);
      if (body.status === 'published') return entry('post.publish', `Published post ${quoted(name)}`);
      return entry('post.update', join(`Updated post ${quoted(name ?? id)}`, fieldList(body)));
    }
    case 'subscribers':
      return entry('subscriber.delete', `Removed subscriber ${id ?? ''}`);
    case 'discounts': {
      if (c === 'codes') {
        const n = Number(body.count) || 0;
        return method === 'DELETE'
          ? entry('discount.codes.delete', `Deleted unused codes for discount ${quoted(pre)}`)
          : entry('discount.codes.create', `Generated ${n} ${n === 1 ? 'code' : 'codes'} for discount ${quoted(pre)}`);
      }
      if (method === 'POST' && !b) return entry('discount.create', `Created discount ${quoted(name)}`, result?.id ? String(result.id) : null);
      if (method === 'DELETE') {
        if (result?.deactivated === true) return entry('discount.deactivate', `Deactivated discount ${quoted(pre ?? id)} (it was used)`);
        return entry('discount.delete', `Deleted discount ${quoted(pre ?? id)}`);
      }
      if (b && !c) return entry('discount.update', join(`Updated discount ${quoted(name ?? id)}`, fieldList(body)));
      return entry(`discount.${op}`, join(`${verb} discounts`, b, c), null);
    }
    case 'shipping': {
      const sub = b === 'methods' || d === 'methods' ? 'method' : 'zone';
      const sid = c ? decodeURIComponent(c) : null;
      if (b === 'zones' && d === 'methods') return entry('shipping.method.create', `Added shipping method ${str(body.name)} to ${quoted(pre)}`, sid, 'shipping');
      if (method === 'POST') return entry(`shipping.${sub}.create`, `Created shipping ${sub} ${quoted(name)}`, result?.id ? String(result.id) : null, 'shipping');
      if (method === 'DELETE') return entry(`shipping.${sub}.delete`, `Deleted shipping ${sub} ${quoted(pre ?? sid)}`, sid, 'shipping');
      return entry(`shipping.${sub}.update`, join(`Updated shipping ${sub} ${quoted(name ?? sid)}`, fieldList(body)), sid, 'shipping');
    }
    case 'settings':
      return entry('settings.update', join('Changed settings', fieldList(body, 8)), null);
    case 'tax-rates': {
      const country = (result && str(result.country)) || pre || str(body.country) || null;
      const rate = typeof body.rate === 'number' ? `${Math.round(body.rate * 10000) / 100}%` : null;
      if (method === 'POST') return entry('taxRate.create', join(`Added tax rate for ${quoted(country)}`, rate), result?.id ? String(result.id) : null);
      if (method === 'DELETE') return entry('taxRate.delete', `Deleted tax rate for ${quoted(pre ?? id)}`);
      return entry('taxRate.update', join(`Updated tax rate for ${quoted(country ?? id)}`, rate ?? fieldList(body)));
    }
    case 'staff': {
      // Template roles (D5): `PATCH staff/:id {roles}`, `DELETE staff/:id`, `POST staff/invite {email, roles}`.
      if (b === 'invite') {
        const email = str(body.email).trim().toLowerCase();
        const roleNames = strings(result?.roleNames).join(', ') || strings(body.roles).join(', ') || 'staff';
        if (result?.status === 'granted') return entry('staff.grant', `Gave ${email} access as ${roleNames}`, email || null);
        const areas = strings(result?.areas);
        const scope = areas.length === 0 || areas.length >= 8 ? 'every area' : areas.join(', ');
        return entry('staff.invite', `Invited ${email} as ${roleNames} · ${scope}`, email || null);
      }
      if (method === 'DELETE') return entry('staff.remove', `Removed staff access for ${quoted(pre ?? id)}`);
      const roles = strings(body.roles);
      return entry('staff.update', join(`Changed access for ${quoted(pre ?? name ?? id)}`, roles.length ? `roles ${roles.join(', ')}` : null));
    }
    case 'emails': {
      const key = c ? decodeURIComponent(c) : null;
      if (b === 'templates' && d === 'preview') return null;
      if (b === 'templates' && d === 'test') return entry('email.test', `Sent a test ${quoted(key)} email${body.to ? ` to ${str(body.to)}` : ''}`, key, 'email');
      if (b === 'templates' && d === 'reset') return entry('email.template.reset', `Reset email template ${quoted(key)} to the default`, key, 'email');
      if (b === 'templates' && key) return entry('email.template.update', join(`Updated email template ${quoted(key)}`, fieldList(body)), key, 'email');
      if (b === 'messages' && d === 'resend') return entry('email.resend', `Resent email${nameOf(result) ? ` to ${nameOf(result)}` : ''}`, key, 'email');
      return entry(`email.${op}`, join(`${verb} email`, b, d), key, 'email');
    }
    case 'abandoned': {
      if (b === 'run') return entry('cart.reminders.run', 'Ran abandoned bag reminders now', null, 'cart');
      if (b === 'bulk') {
        const n = count(body.ids);
        return entry('cart.bulk', join(`Updated ${n} abandoned ${n === 1 ? 'bag' : 'bags'}`, str(body.action)), null, 'cart');
      }
      if (c === 'remind') return entry('cart.remind', `Sent an abandoned bag reminder${nameOf(result) ? ` to ${nameOf(result)}` : ''}`, id, 'cart');
      return entry(`cart.${op}`, `${verb} abandoned bag`, id, 'cart');
    }
    case 'reviews': {
      if (b === 'bulk') {
        const n = count(body.ids);
        return entry('review.bulk', join(`Updated ${n} ${n === 1 ? 'review' : 'reviews'}`, body.status ? `marked ${lower(body.status)}` : str(body.action)), null);
      }
      const title = pre ?? name;
      if (method === 'DELETE') return entry('review.delete', `Deleted review ${quoted(title ?? id)}`);
      if (body.status) return entry('review.moderate', `Marked review ${quoted(title)} ${lower(body.status)}`);
      if (body.reply !== undefined) return entry('review.reply', `Replied to review ${quoted(title)}`);
      return entry('review.update', join(`Updated review ${quoted(title)}`, fieldList(body)));
    }
    case 'collections':
      if (b === 'product-order') return reorderProducts(body.category ?? body.categoryId);
      if (b === 'order') return entry('collection.reorder', 'Reordered collections', null);
      if (method === 'POST' && !b) return entry('collection.create', `Created collection ${quoted(name)}`, result?.id ? String(result.id) : null);
      if (method === 'DELETE') return entry('collection.delete', `Deleted collection ${quoted(pre ?? id)}`);
      return entry('collection.update', join(`Updated collection ${quoted(name ?? id)}`, fieldList(body)));
    default: {
      // Routers without a case of their own (pages, menus, payments, translations…).
      const label = entity;
      if (method === 'POST' && !b) return entry(`${a}.create`, join(`Created ${label}`, name), result?.id ? String(result.id) : null);
      if (method === 'DELETE') return entry(`${a}.delete`, join(`Deleted ${label}`, pre ?? name ?? id), id);
      if (b && !c && /^[a-z][a-z-]{1,18}$/.test(b) && method === 'POST') {
        return entry(`${a}.${b.replace(/-/g, '_')}`, join(`${b[0]!.toUpperCase()}${b.slice(1).replace(/-/g, ' ')} · ${label}`, name), null);
      }
      const tail = segs
        .slice(2)
        .filter(s => !/^[a-z0-9]{20,}$/i.test(s) && !/^\d+$/.test(s))
        .join(' ');
      return entry(
        `${a}.${tail ? tail.replace(/\W+/g, '_') : op}`,
        join(`${tail ? `${tail[0]!.toUpperCase()}${tail.slice(1)}` : verb} ${label}`.trim(), name ?? (b && b !== tail ? id : null), !tail && method !== 'POST' ? fieldList(body) : null),
        id
      );
    }
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────

async function readBody(c: Context): Promise<Row> {
  try {
    if (!/json/i.test(c.req.header('Content-Type') ?? '')) return {};
    const text = await c.req.text(); // cached by Hono, so the handler's validator still reads it
    const v = text.trim() ? JSON.parse(text) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
  } catch {
    return {};
  }
}

async function readResult(res: Response): Promise<Row | null> {
  try {
    if (!/json/i.test(res.headers.get('Content-Type') ?? '')) return null;
    const v = await res.clone().json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
  } catch {
    return null;
  }
}

/** Does this write need the record's name read before the handler runs? */
const needsPre = (method: string, segs: string[]) =>
  method === 'DELETE' || segs[0] === 'inventory' || segs[0] === 'reviews' || segs[0] === 'staff' || segs.length > 2;

/**
 * Mount on `/site-api/manage` after the auth and area checks (`base` is the mount prefix to strip). The database
 * comes from `getDb()`: `withDb` runs per handler, after this. Without a database it passes through.
 */
export const activityLogMiddleware = (base = '/site-api/manage'): MiddlewareHandler =>
  createMiddleware(async (c, next) => {
    const method = c.req.method.toUpperCase();
    const segs = segmentsOf(c.req.path, base);
    if (!MUTATIONS.has(method) || !segs.length || SKIP.has(segs[0]!)) return next();
    const db = getDb();
    if (!db) return next();

    let body: Row = {};
    let pre: string | null = null;
    try {
      body = await readBody(c);
      if (needsPre(method, segs)) pre = await lookupName(db, segs);
    } catch {
      /* never block the request */
    }

    await next();

    let action = 'unknown';
    try {
      if (c.res.status < 200 || c.res.status >= 300 || c.error) return;
      const result = await readResult(c.res);
      const e = describe({method, segs, body, result, pre});
      if (!e) return;
      action = e.action;
      await logActivity(db, actorOf(c), e);
    } catch {
      console.error(`[activity] skipped ${action}`);
    }
  });

/**
 * The `recordActivity` contract's body (src/server/lib/contracts.ts): one row from code that is not a manage
 * route (jobs, webhooks, a route that wants its own wording). Never throws.
 */
export async function writeActivity(
  db: Db,
  actor: {id: number | null; name: string} | null,
  action: string,
  target: {entity: string; id?: string | number | null},
  meta: {summary?: string} & Record<string, unknown> = {}
): Promise<void> {
  try {
    const actorName = (actor?.name?.trim() || (actor?.id ? `User ${actor.id}` : 'System')).slice(0, 120);
    const summary = (typeof meta.summary === 'string' && meta.summary.trim() ? meta.summary : action).replace(/\s+/g, ' ').trim().slice(0, 500);
    await db.activityLog.create({
      data: {
        userId: actor?.id ?? null,
        actorName,
        action: action.slice(0, 60),
        entity: target.entity.slice(0, 40),
        entityId: target.id == null || target.id === '' ? null : String(target.id).slice(0, 120),
        summary,
      },
      select: {id: true},
    });
  } catch {
    console.error(`[activity] could not write ${action.slice(0, 60)}`);
  }
}
