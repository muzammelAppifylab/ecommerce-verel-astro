import {Hono} from 'hono';
import {z} from 'zod';

import type {ReturnLookupResponse} from '../../lib/types/orders';
import {withDb, withViewer} from '../../platform/guards';
import type {Viewer} from '../../platform/types';
import type {Db} from '../lib/contracts';
import {HttpError} from '../lib/errors';
import {normEmail, plural} from '../lib/format';
import {EN_LOC, type Loc, locOf} from '../lib/i18n/localize';
import {DELIVERED_EVENT} from '../lib/orders';
import {getSettings} from '../lib/settings';
import {json, optionalText} from '../lib/validate';
import {rateLimit} from '../lib/rate-limit';
import {findOrderByNumber, isOrderOwner, orderNumberOf, redactOrder, toOrder, tokenExpired} from './orders';

/**
 * Returns (customer). WP-14 (docs/migration/PLAN.md §5), port of VAREL worker/routes/orders.ts (returns part):
 * VAREL `/api/<path>` is `/site-api/<path>` here, same shapes (src/lib/types/orders.ts), errors as
 * `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   POST   /site-api/returns/lookup   ReturnLookupInput → ReturnLookupResponse (+ `access`)
 *   POST   /site-api/returns          CreateReturnInput → 201 CreateReturnResponse
 *
 * Differences from VAREL (security): a lookup by the order number ALONE answers a redacted order (masked email,
 * no phone, address, card, tracking or download links: VAREL answered the full order to anyone holding a
 * number), and booking a return needs the owner or the order's email. Duplicate lines in one request are
 * summed before the "more than is left" check; at most 50 requests per order; `lineId` is stored as a number
 * (`shop_order_items.id`).
 */

/** How the lookup was authorised: the signed-in owner, the order's email, or the number alone (redacted). */
export type ReturnAccess = 'owner' | 'email' | 'number';
export type ReturnLookupResult = ReturnLookupResponse & {access: ReturnAccess};

/** Most return requests one order can hold (a customer never needs more; stops a loop filling the table). */
export const MAX_RETURNS_PER_ORDER = 50;

interface EligibilityOrder {
  id: number;
  payment: string;
  fulfillment: string;
  placedAt: Date;
}

/** When the order was delivered: the latest "Marked as delivered…" status event, else the order date. */
async function deliveredAt(db: Db, o: EligibilityOrder): Promise<Date> {
  const ev = await db.shopOrderEvent.findFirst({
    where: {orderId: o.id, kind: 'status', message: {startsWith: DELIVERED_EVENT}},
    orderBy: {at: 'desc'},
    select: {at: true},
  });
  return ev?.at ?? o.placedAt;
}

/** Can this order be returned now? The reason is in the request language. */
export async function eligibility(
  db: Db,
  o: EligibilityOrder,
  returnWindowDays: number,
  loc: Loc = EN_LOC,
  now = Date.now()
): Promise<{eligible: boolean; reason?: string}> {
  const t = loc.t;
  // A fully refunded order has nothing left to return, whatever its fulfilment says.
  if (o.payment === 'Refunded') return {eligible: false, reason: t('returns.refunded', {}, 'This order has already been refunded')};
  if (o.fulfillment === 'Delivered') {
    const closes = (await deliveredAt(db, o)).getTime() + returnWindowDays * 86_400_000;
    if (now > closes) {
      return {
        eligible: false,
        reason: t(
          'returns.closeAfter',
          {count: returnWindowDays},
          `Returns close ${plural(returnWindowDays, 'day')} after delivery`
        ),
      };
    }
    return {eligible: true};
  }
  if (o.fulfillment === 'Returned') {
    return {eligible: false, reason: t('returns.returned', {}, 'This order has already been returned and refunded')};
  }
  return {eligible: false, reason: t('returns.notDelivered', {}, 'Returns open once your order has been delivered')};
}

/** Units already asked back per line (every previous request, whatever its status: VAREL). Accepts numeric and
    string `lineId`s (older rows); bad entries are skipped, quantities floored at 0. */
export function remainingByLine(previous: {items: unknown}[]): Map<number, number> {
  const already = new Map<number, number>();
  for (const r of previous) {
    if (!Array.isArray(r.items)) continue;
    for (const raw of r.items as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const it = raw as {lineId?: unknown; qty?: unknown};
      const id =
        typeof it.lineId === 'number' ? it.lineId : typeof it.lineId === 'string' && /^\d{1,12}$/.test(it.lineId.trim()) ? Number(it.lineId) : NaN;
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const qty = Math.max(0, Math.floor(Number(it.qty ?? 0)) || 0);
      already.set(id, (already.get(id) ?? 0) + qty);
    }
  }
  return already;
}

/** Field errors for the pieces asked back: unknown line, digital line, more than is left (duplicates summed). */
export function checkReturnItems(
  lines: {id: number; qty: number; digital: boolean}[],
  items: {lineId: number; qty: number}[],
  already: Map<number, number>
): Record<string, string> {
  const fields: Record<string, string> = {};
  const asked = new Map<number, number>();
  items.forEach((it, i) => {
    const line = lines.find(x => x.id === it.lineId);
    if (!line) {
      fields[`items.${i}.lineId`] = 'That piece is not part of this order';
      return;
    }
    if (line.digital) {
      fields[`items.${i}.lineId`] = 'Digital products cannot be returned';
      return;
    }
    const total = (asked.get(line.id) ?? 0) + it.qty;
    asked.set(line.id, total);
    if (total > line.qty - (already.get(line.id) ?? 0)) fields[`items.${i}.qty`] = 'That is more than is left to return';
  });
  return fields;
}

const ORDER_MESSAGE = 'Enter the order number from your confirmation email';
const lookupBody = z.object({
  order: z.string({error: ORDER_MESSAGE}).trim().min(1, ORDER_MESSAGE).max(20, ORDER_MESSAGE),
  email: optionalText(254),
});

const PIECE = 'That piece is not part of this order';
const CHOOSE = 'Choose at least one piece to return';
const WHY = 'Tell us why in one line';
const returnBody = lookupBody.extend({
  items: z
    .array(
      z.object({
        lineId: z
          .union([z.number({error: PIECE}).int(PIECE).positive(PIECE), z.string({error: PIECE}).trim().regex(/^\d{1,12}$/, PIECE)])
          .transform(Number),
        qty: z.coerce.number({error: 'Use a whole number'}).int('Use a whole number').min(1, 'Return at least one').max(999, 'That is more than is left to return'),
        reason: z.string({error: WHY}).trim().min(1, WHY).max(300, 'Keep the reason under 300 characters'),
      }),
      {error: CHOOSE}
    )
    .min(1, CHOOSE)
    .max(50, 'Return at most 50 pieces at a time'),
});

/** Find the order and decide what the caller may see (VAREL findReturnableOrder + access). */
async function lookupOrder(db: Db, viewer: Viewer, number: string, email: string | null) {
  const order = await findOrderByNumber(db, await orderNumberOf(db, number));
  if (!order) throw new HttpError(404, 'order_not_found', 'We cannot find that order number. Check your confirmation email');
  const owner = isOrderOwner(viewer, order);
  if (email && !owner && normEmail(email) !== normEmail(order.email)) {
    throw new HttpError(404, 'order_not_found', 'That order number and email do not match');
  }
  const access: ReturnAccess = owner ? 'owner' : email ? 'email' : 'number';
  // An owner whose access token aged must not get the redacted view: refresh and retry first.
  if (access === 'number' && viewer.state === 'returning') throw tokenExpired();
  return {order, access};
}

/** Mounted at `/site-api/returns` (src/server/app.ts). */
export const returnRoutes = new Hono()
  /* POST /returns/lookup — the order and whether it can be returned (the owner, a matching email, or the number
     alone, then redacted). */
  .post('/lookup', json(lookupBody), withViewer, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    // Order numbers are guessable: limit look-ups per IP (I2).
    await rateLimit(c, db, 'returnsLookup');
    const {order, access} = await lookupOrder(db, c.var.viewer, input.order, input.email);
    const [loc, settings] = await Promise.all([locOf(c), getSettings(db)]);
    const {eligible, reason} = await eligibility(db, order, settings.returnWindowDays, loc);
    const full = toOrder(order, loc);
    const body: ReturnLookupResult = {
      order: access === 'number' ? redactOrder(full) : full,
      eligible,
      ...(reason ? {reason} : {}),
      access,
    };
    return c.json(body);
  })

  /* POST /returns — book a return for some pieces of a delivered order (the owner or the order's email). */
  .post('/', json(returnBody), withViewer, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    await rateLimit(c, db, 'returnsCreate');
    const {order, access} = await lookupOrder(db, c.var.viewer, input.order, input.email);
    if (access === 'number') {
      throw new HttpError(422, 'invalid_input', 'Enter the email you used for this order', {
        email: 'Enter the email you used for this order',
      });
    }
    const [loc, settings] = await Promise.all([locOf(c), getSettings(db)]);
    const {eligible, reason} = await eligibility(db, order, settings.returnWindowDays, loc);
    if (!eligible) throw new HttpError(422, 'return_not_eligible', reason ?? 'This order cannot be returned');

    const previous = await db.returnRequest.findMany({
      where: {orderId: order.id},
      select: {items: true},
      take: MAX_RETURNS_PER_ORDER + 1,
    });
    if (previous.length >= MAX_RETURNS_PER_ORDER) {
      throw new HttpError(429, 'too_many_returns', 'This order has too many return requests. Write to the studio');
    }
    const fields = checkReturnItems(order.items, input.items, remainingByLine(previous));
    if (Object.keys(fields).length) throw new HttpError(422, 'invalid_input', 'Check the pieces you are returning', fields);

    const units = input.items.reduce((n, it) => n + it.qty, 0);
    const created = await db.$transaction(async tx => {
      // Optimistic lock: two requests racing for the same pieces cannot both pass the check above.
      const locked = await tx.shopOrder.updateMany({
        where: {id: order.id, updatedAt: order.updatedAt},
        data: {updatedAt: new Date()},
      });
      if (!locked.count) throw new HttpError(409, 'conflict', 'This order just changed. Try again');
      const r = await tx.returnRequest.create({
        data: {
          orderId: order.id,
          email: order.email,
          items: input.items.map(i => ({lineId: i.lineId, qty: i.qty, reason: i.reason})),
          status: 'Requested',
        },
        select: {id: true},
      });
      await tx.shopOrderEvent.create({
        data: {orderId: order.id, kind: 'return', message: `Return requested · ${plural(units, 'item')}`, by: null},
      });
      return r;
    });
    return c.json({id: String(created.id), status: 'Requested' as const}, 201);
  });
