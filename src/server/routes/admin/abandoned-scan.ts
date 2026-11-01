/* Abandoned bags: the bounded reads and the pure row logic behind `/site-api/manage/abandoned` and the
   `abandoned-carts` job (port of VAREL worker/routes/admin/abandoned.ts `rowOf`, `recovered`, `latestOrders`
   and worker/lib/abandoned.ts `bagsWithContact`/`dueCarts`).

   VAREL loaded every bag with a contact into the Worker and filtered in memory. Here:
   - the candidate scan is ONE aggregate query in the database (`scanBags`, `dueBagIds`) ordered by the
     bag's true last activity (max of the cart row's `updated_at` and its newest published line), at most
     SCAN_LIMIT ids, then the details for those ids with a slim select (`bagSelect`, no descriptions);
   - "superseded" needs every bag of the same shopper: `siblingsOf` reads them by contact email (bounded);
   - orders and the "recovered" numbers are bounded `groupBy` / `findMany` reads keyed by email or user id.
   Nothing here counts a whole table. */
import {Prisma} from '../../../generated/prisma/client';
import type {AbandonedBagRow, AbandonedStatus} from '../../../lib/types/admin/merchandising';
import {contactEmail} from '../../lib/abandoned';
import type {Db} from '../../lib/db';
import type {CursorPage} from '../../../lib/types/common';
import {type CursorValue, decodeCursor, keysetPage} from '../../lib/http';
import {fromCents, round2} from '../../lib/money';
import {photoOf} from '../../lib/serializers';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** An order within this time after a reminder counts as recovered (VAREL RECOVERY_WINDOW). */
export const RECOVERY_WINDOW = 7 * DAY;
/** The "Recovered · 30 days" tile looks this far back. */
export const RECOVERY_LOOKBACK = 30 * DAY;
/** Most bags the admin list derives its rows and summary from (the most recently active ones). */
export const SCAN_LIMIT = 500;
/** Most other bags read per call to decide which bag of a shopper is the newest. */
export const SIBLING_LIMIT = 200;
/** Most reminder emails / orders read for the recovered tile. */
const RECOVERED_LIMIT = 1000;

export const ABANDONED_STATUSES = ['active', 'abandoned', 'reminded', 'superseded', 'dismissed', 'ordered'] as const satisfies readonly AbandonedStatus[];
export const ABANDONED_SORTS = ['lastActivity', '-lastActivity', 'value', '-value'] as const;
export type AbandonedSort = (typeof ABANDONED_SORTS)[number];

/** What the list and the status logic read of a bag: no product description, no stock, one image. */
export const bagSelect = {
  id: true,
  userId: true,
  email: true,
  locale: true,
  reminderSentAt: true,
  dismissedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {select: {id: true, email: true, name: true, status: true, customerProfile: {select: {firstName: true, lastName: true}}}},
  lines: {
    where: {product: {status: 'published'}},
    orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
    take: 100,
    select: {
      id: true,
      qty: true,
      createdAt: true,
      productId: true,
      product: {select: {name: true, images: {orderBy: {position: 'asc'}, take: 1, select: {src: true, credit: true, creditHref: true}}}},
      variant: {select: {color: true, size: true, priceCents: true}},
    },
  },
} satisfies Prisma.CartSelect;

export type Bag = Prisma.CartGetPayload<{select: typeof bagSelect}>;

/** The fields the pure helpers below read (both `Bag` and F4's `AbandonedRow` have them). */
type Contact = Pick<Bag, 'email' | 'user'>;
type Times = {updatedAt: Date; lines: {createdAt: Date}[]};

// ─── Pure status logic (VAREL lib/abandoned.ts, structural so both row shapes fit) ──

/** The newest line's time (0 when the bag has no lines). */
export const newestLineAt = (bag: {lines: {createdAt: Date}[]}) => Math.max(0, ...bag.lines.map(l => l.createdAt.getTime()));

/** Last time the shopper touched the bag: the cart row (email capture, a code) or its newest line. */
export const lastActivityAt = (bag: Times) => Math.max(bag.updatedAt.getTime(), newestLineAt(bag));

/** This bag's current contents already had a reminder. */
export const isReminded = (bag: {reminderSentAt: Date | null; lines: {createdAt: Date}[]}) =>
  !!bag.reminderSentAt && bag.reminderSentAt.getTime() >= newestLineAt(bag);

/** Staff dismissed this bag and the shopper has not added anything since. */
export const isDismissed = (bag: {dismissedAt: Date | null; lines: {createdAt: Date}[]}) =>
  !!bag.dismissedAt && bag.dismissedAt.getTime() >= newestLineAt(bag);

/** The lower-cased address a reminder would go to, or null. */
export const contactKey = (bag: Contact) => contactEmail(bag)?.toLowerCase() ?? null;

/**
 * Ids of bags that a newer bag from the same email address supersedes (F4 `supersededIds`, for any row
 * shape): only the newest bag per shopper is reminded. Ties keep the first one seen.
 */
export function olderBagIds(bags: (Contact & Times & {id: number})[]): Set<number> {
  const newest = new Map<string, {id: number; at: number}>();
  for (const b of bags) {
    const e = contactKey(b);
    if (!e || !b.lines.length) continue;
    const at = lastActivityAt(b);
    const cur = newest.get(e);
    if (!cur || at > cur.at) newest.set(e, {id: b.id, at});
  }
  const out = new Set<number>();
  for (const b of bags) {
    const e = contactKey(b);
    if (e && b.lines.length && newest.get(e)?.id !== b.id) out.add(b.id);
  }
  return out;
}

/**
 * A bag's status, VAREL's precedence: ordered → dismissed → superseded → reminded → abandoned (idle for
 * `hours` or longer) → active. `orderedAt` = the shopper's latest order time (ms) when there is one.
 */
export function bagStatus(
  bag: Times & {id: number; createdAt: Date; reminderSentAt: Date | null; dismissedAt: Date | null},
  hours: number,
  now: number,
  older: Set<number>,
  orderedAt?: number
): AbandonedStatus {
  const newest = Math.max(bag.createdAt.getTime(), newestLineAt(bag));
  if (orderedAt !== undefined && orderedAt >= newest) return 'ordered';
  if (isDismissed(bag)) return 'dismissed';
  if (older.has(bag.id)) return 'superseded';
  if (isReminded(bag)) return 'reminded';
  return now - lastActivityAt(bag) >= hours * HOUR ? 'abandoned' : 'active';
}

/** The bag's value in major units: variant price × qty, without discounts (VAREL `bagValue`). */
export const valueOf = (bag: Pick<Bag, 'lines'>) => round2(bag.lines.reduce((n, l) => n + fromCents(l.variant.priceCents * l.qty), 0));

/** The shopper's name for the list: the profile's name, else the account name; never for an anonymised account. */
export function customerNameOf(bag: Pick<Bag, 'user'>): string | null {
  const u = bag.user;
  if (!u || u.email.endsWith('.invalid')) return null;
  const profile = `${u.customerProfile?.firstName ?? ''} ${u.customerProfile?.lastName ?? ''}`.trim();
  return profile || u.name.trim() || null;
}

/** One row of the admin list (VAREL `rowOf`). */
export function rowOf(bag: Bag, hours: number, now: number, older: Set<number>, orderedAt?: number): AbandonedBagRow {
  return {
    id: String(bag.id),
    email: contactEmail(bag) ?? '',
    customerName: customerNameOf(bag),
    userId: bag.userId === null ? null : String(bag.userId),
    value: valueOf(bag),
    itemCount: bag.lines.reduce((n, l) => n + l.qty, 0),
    items: bag.lines.map(l => ({
      name: l.product.name,
      meta: [l.variant.color, l.variant.size].filter(Boolean).join(' · '),
      qty: l.qty,
      total: fromCents(l.variant.priceCents * l.qty),
      image: photoOf(l.product.images[0]),
      productId: l.productId,
    })),
    createdAt: bag.createdAt.toISOString(),
    lastActivity: new Date(lastActivityAt(bag)).toISOString(),
    reminderSentAt: bag.reminderSentAt?.toISOString() ?? null,
    dismissedAt: bag.dismissedAt?.toISOString() ?? null,
    status: bagStatus(bag, hours, now, older, orderedAt),
  };
}

// ─── Sorting and keyset slicing over derived rows ───────────────────────────

const keyOf = (row: AbandonedBagRow, sort: AbandonedSort): [string | number, number] => [
  sort.endsWith('value') ? row.value : row.lastActivity,
  Number(row.id),
];

function compareKeys(a: readonly [string | number, number], b: readonly [string | number, number], desc: boolean): number {
  const d =
    typeof a[0] === 'number' && typeof b[0] === 'number' ? a[0] - b[0] : String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0;
  const n = d !== 0 ? d : a[1] - b[1];
  return desc ? -n : n;
}

/** Rows in the list's order: the sort field, then the id in the same direction. */
export function sortRows(rows: AbandonedBagRow[], sort: AbandonedSort): AbandonedBagRow[] {
  const desc = sort.startsWith('-');
  return [...rows].sort((a, b) => compareKeys(keyOf(a, sort), keyOf(b, sort), desc));
}

/** The cursor's `[sortValue, id]`, or null when it is missing, malformed or of the other sort. */
function cursorKey(cursor: string | undefined, sort: AbandonedSort): [string | number, number] | null {
  const values: CursorValue[] | null = decodeCursor(cursor, 2);
  if (!values) return null;
  const [v, id] = values;
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  if (sort.endsWith('value') ? typeof v !== 'number' : typeof v !== 'string') return null;
  return [v as string | number, id];
}

/**
 * One keyset page of rows already sorted by `sortRows`: the rows strictly after the cursor's
 * `(value, id)` (not an index, so rows that change between pages never repeat). A bad cursor starts
 * from the top.
 */
export function sliceAfter(sorted: AbandonedBagRow[], sort: AbandonedSort, cursor: string | undefined, size: number): CursorPage<AbandonedBagRow> {
  const desc = sort.startsWith('-');
  const after = cursorKey(cursor, sort);
  const start = after ? sorted.findIndex(r => compareKeys(keyOf(r, sort), after, desc) > 0) : 0;
  const rest = start < 0 ? [] : sorted.slice(start, start + size + 1);
  return keysetPage(rest, size, r => keyOf(r, sort));
}

// ─── Database reads (all bounded) ───────────────────────────────────────────

/** Details for ids in the given order; bags without published lines or a contact email drop out. */
export async function bagsByIds(db: Db, ids: number[]): Promise<Bag[]> {
  if (!ids.length) return [];
  const rows = await db.cart.findMany({where: {id: {in: ids}}, select: bagSelect, take: ids.length});
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => byId.get(id)).filter((b): b is Bag => !!b && b.lines.length > 0 && contactEmail(b) !== null);
}

/**
 * Q1 (list form): the `limit` most recently active bags with published pieces and a contact address
 * (the checkout email, else an active, non-anonymised account's email), newest first.
 * `capped` = there are more than `limit`.
 */
export async function scanBags(db: Db, {limit = SCAN_LIMIT}: {limit?: number} = {}): Promise<{bags: Bag[]; capped: boolean}> {
  const rows = await db.$queryRaw<{id: number}[]>`
    SELECT c.id
    FROM carts c
    JOIN cart_lines l ON l.cart_id = c.id
    JOIN products p ON p.id = l.product_id AND p.status = 'published'
    LEFT JOIN users u ON u.id = c.user_id
    WHERE NULLIF(c.email, '') IS NOT NULL
       OR (u.id IS NOT NULL AND u.status = 'active' AND u.email NOT LIKE '%.invalid')
    GROUP BY c.id
    ORDER BY GREATEST(c.updated_at, max(l.created_at)) DESC, c.id DESC
    LIMIT ${limit + 1}`;
  const ids = rows.slice(0, limit).map(r => Number(r.id));
  return {bags: await bagsByIds(db, ids), capped: rows.length > limit};
}

/**
 * Q1 (job form): ids of bags idle since before `cutoff` whose current contents were neither reminded
 * nor dismissed, OLDEST activity first (so the longest-waiting bags are never starved), at most `take`.
 * Superseded bags and orders placed since are checked afterwards.
 */
export async function dueBagIds(db: Db, cutoff: Date, take: number): Promise<number[]> {
  const rows = await db.$queryRaw<{id: number}[]>`
    SELECT c.id
    FROM carts c
    JOIN cart_lines l ON l.cart_id = c.id
    JOIN products p ON p.id = l.product_id AND p.status = 'published'
    LEFT JOIN users u ON u.id = c.user_id
    WHERE NULLIF(c.email, '') IS NOT NULL
       OR (u.id IS NOT NULL AND u.status = 'active' AND u.email NOT LIKE '%.invalid')
    GROUP BY c.id
    HAVING GREATEST(c.updated_at, max(l.created_at)) < ${cutoff}
       AND (c.reminder_sent_at IS NULL OR c.reminder_sent_at < max(l.created_at))
       AND (c.dismissed_at IS NULL OR c.dismissed_at < max(l.created_at))
    ORDER BY GREATEST(c.updated_at, max(l.created_at)) ASC, c.id ASC
    LIMIT ${take}`;
  return rows.map(r => Number(r.id));
}

/** Q2 for the job / bulk: the slim rows of these bags, in this order. */
export const slimBags = bagsByIds;

/**
 * Q3: the OTHER bags (with published pieces) of the same contact addresses, so the newest bag per
 * shopper can be told apart. Matches the checkout email or the account email, case-insensitively.
 */
export async function siblingsOf(db: Db, bags: (Contact & {id: number})[]): Promise<Bag[]> {
  const emails = [...new Set(bags.map(contactKey).filter((e): e is string => !!e))];
  if (!emails.length) return [];
  const rows = await db.cart.findMany({
    where: {
      id: {notIn: bags.map(b => b.id)},
      lines: {some: {product: {status: 'published'}}},
      OR: [{email: {in: emails, mode: 'insensitive'}}, {user: {email: {in: emails, mode: 'insensitive'}}}],
    },
    select: bagSelect,
    take: SIBLING_LIMIT,
  });
  return rows.filter(r => r.lines.length > 0);
}

/**
 * Q4: the latest order time per lower-cased contact email and per user id, for these bags (orders placed
 * since the oldest bag was started). Emails match exactly: checkout stores them lower-cased.
 */
export async function latestOrders(db: Db, bags: (Contact & {userId: number | null; createdAt: Date})[]): Promise<(bag: Contact & {userId: number | null}) => number | undefined> {
  const at = new Map<string, number>();
  if (bags.length) {
    const emails = [...new Set(bags.map(contactKey).filter((e): e is string => !!e))];
    const users = [...new Set(bags.map(b => b.userId).filter((v): v is number => v !== null))];
    const since = new Date(Math.min(...bags.map(b => b.createdAt.getTime())));
    const [byEmail, byUser] = await Promise.all([
      emails.length
        ? db.shopOrder.groupBy({by: ['email'], where: {email: {in: emails}, placedAt: {gte: since}}, _max: {placedAt: true}})
        : Promise.resolve([]),
      users.length
        ? db.shopOrder.groupBy({by: ['userId'], where: {userId: {in: users}, placedAt: {gte: since}}, _max: {placedAt: true}})
        : Promise.resolve([]),
    ]);
    const bump = (k: string, t: Date | null | undefined) => {
      if (t) at.set(k, Math.max(at.get(k) ?? 0, t.getTime()));
    };
    for (const o of byEmail) bump(`e:${o.email.toLowerCase()}`, o._max.placedAt);
    for (const o of byUser) if (o.userId !== null) bump(`u:${o.userId}`, o._max.placedAt);
  }
  return bag => {
    const e = contactKey(bag);
    const t = Math.max(e ? (at.get(`e:${e}`) ?? -1) : -1, bag.userId !== null ? (at.get(`u:${bag.userId}`) ?? -1) : -1);
    return t < 0 ? undefined : t;
  };
}

/**
 * Q5: reminders sent in the last 30 days that were followed by a paid, not cancelled order from the same
 * address within 7 days. Revenue in major units.
 */
export async function recovered(db: Db, now: number): Promise<{orders: number; revenue: number}> {
  const from = new Date(now - RECOVERY_LOOKBACK);
  const sent = await db.emailMessage.findMany({
    where: {template: 'abandoned_cart', createdAt: {gte: from}, status: {not: 'failed'}},
    select: {to: true, createdAt: true},
    orderBy: {createdAt: 'desc'},
    take: RECOVERED_LIMIT,
  });
  if (!sent.length) return {orders: 0, revenue: 0};
  const byEmail = new Map<string, number[]>();
  for (const s of sent) {
    const k = s.to.toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), s.createdAt.getTime()]);
  }
  const orders = await db.shopOrder.findMany({
    where: {email: {in: [...byEmail.keys()]}, placedAt: {gte: from}, payment: 'Paid', fulfillment: {not: 'Cancelled'}},
    select: {email: true, totalCents: true, placedAt: true},
    take: RECOVERED_LIMIT,
  });
  const hit = orders.filter(o => {
    const t = o.placedAt.getTime();
    return (byEmail.get(o.email.toLowerCase()) ?? []).some(s => t >= s && t - s <= RECOVERY_WINDOW);
  });
  return {orders: hit.length, revenue: round2(hit.reduce((n, o) => n + fromCents(o.totalCents), 0))};
}

export {Prisma};
