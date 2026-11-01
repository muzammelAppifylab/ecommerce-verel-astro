import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import type {AdminReturn, AdminReturnRow, ReturnStatus} from '../../../lib/types/admin/sales';
import {type CursorPage, PAGE_SIZE} from '../../../lib/types/common';
import {requirePermission, withDb} from '../../../platform/guards';
import type {Viewer} from '../../../platform/types';
import {PERMISSIONS} from '../../permissions';
import {type Db, refundOrder} from '../../lib/contracts';
import {conflict, notFound} from '../../lib/errors';
import {plural} from '../../lib/format';
import {cursorDate, decodeCursor, keysetPage, keysetWhere, orderByOf, parseSort} from '../../lib/http';
import {fromCents, money, toCents} from '../../lib/money';
import {lineRefund, shippingRefund} from '../../lib/orders';
import {getSettings} from '../../lib/settings';
import {optionValues} from '../../lib/variant-options';
import {json, pageQuery, query} from '../../lib/validate';
import {
  actorName,
  adminOrderRow,
  adminReturnRow,
  badSort,
  clip,
  EVENT_MESSAGE_MAX,
  type LineMoneyCents,
  lineMoney,
  multiOf,
  nullableText,
  type OrderMoneyCents,
  orderMoney,
  orderRowSelect,
  restockLines,
  type ReturnItemJson,
  returnItems,
  searchWords,
  sendReturnUpdate,
  unitsBack,
} from './orders';

/**
 * Admin: Returns (port of VAREL worker/routes/admin/orders.ts, returns part; WP-19).
 * VAREL `/api/admin/returns…` is `/site-api/manage/returns…` here.
 *
 *   GET    /site-api/manage/returns                    CursorPage<AdminReturnRow> ?q&status&sort&cursor&pageSize
 *   GET    /site-api/manage/returns/:id                AdminReturn
 *   PATCH  /site-api/manage/returns/:id                ReturnUpdate → AdminReturn; 409 return_closed / return_transition / order_refunded
 *
 * Guarded centrally (src/server/routes/admin/index.ts, area orders) and per handler with
 * `requirePermission(SHOP_ORDER_MANAGE)`. A refund moves money FIRST (outside any transaction,
 * idempotent per `refund-return-<id>`), then a conditional write commits the status change, the
 * restock and the order state; the customer's `return_update` email goes after commit.
 */

type Env = {Variables: {viewer: Viewer}};

export const RETURN_STATUSES = ['Requested', 'Approved', 'Rejected', 'Received', 'Refunded'] as const;

/** Allowed return moves. Keeping the same status is always allowed (note-only update). Mirrored in src/portal/queries/returns.ts. */
export const RETURN_NEXT: Record<ReturnStatus, readonly ReturnStatus[]> = {
  Requested: ['Approved', 'Rejected'],
  Approved: ['Received', 'Refunded', 'Rejected'],
  Received: ['Refunded'],
  Rejected: ['Requested'],
  Refunded: [],
};

const RETURN_SORT_FIELDS = ['createdAt'] as const;

export const returnsListQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  sort: z.string().trim().max(40).optional(),
  status: multiOf(RETURN_STATUSES),
  ...pageQuery,
});

const returnOrderSelect = {
  number: true,
  subtotalCents: true,
  discountCents: true,
  taxCents: true,
  pricesIncludeTax: true,
  taxRate: true,
  items: {select: {id: true, priceCents: true, qty: true, discountCents: true}, take: 100},
} satisfies Prisma.ShopOrderSelect;

const returnRowSelect = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  items: true,
  order: {select: returnOrderSelect},
} satisfies Prisma.ReturnRequestSelect;

/** The return with its order: the row fields, the lines it names and the money a refund needs. */
const returnDetailSelect = {
  id: true,
  orderId: true,
  email: true,
  status: true,
  createdAt: true,
  items: true,
  note: true,
  order: {
    select: {
      ...orderRowSelect,
      payment: true,
      paymentProvider: true,
      subtotalCents: true,
      discountCents: true,
      shippingCents: true,
      taxCents: true,
      pricesIncludeTax: true,
      taxRate: true,
      items: {
        select: {id: true, name: true, sku: true, color: true, size: true, options: true, priceCents: true, qty: true, discountCents: true, digital: true},
        orderBy: {position: 'asc'},
        take: 100,
      },
    },
  },
} satisfies Prisma.ReturnRequestSelect;

export type ReturnFull = Prisma.ReturnRequestGetPayload<{select: typeof returnDetailSelect}>;

export function adminReturn(r: ReturnFull): AdminReturn {
  const lines = r.order.items;
  return {
    ...adminReturnRow(r, r.order),
    items: returnItems(r.items).map(it => {
      const line = lines.find(l => l.id === it.lineId);
      return {
        lineId: String(it.lineId),
        name: line?.name ?? 'Removed item',
        sku: line?.sku ?? '',
        color: line?.color ?? null,
        size: line?.size ?? null,
        options: optionValues(line?.options),
        qty: it.qty,
        price: line ? fromCents(line.priceCents) : 0,
        reason: it.reason,
      };
    }),
    note: r.note,
    order: adminOrderRow(r.order),
  };
}

/** `:id` → the return id, or null (anything that is not a small positive integer is a 404). */
export const returnIdOf = (param: string): number | null => {
  const s = param.trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
};

async function loadReturn(db: Db, param: string): Promise<ReturnFull> {
  const id = returnIdOf(param);
  const r = id ? await db.returnRequest.findUnique({where: {id}, select: returnDetailSelect}) : null;
  if (!r) throw notFound('We cannot find that return');
  return r;
}

export const returnPatch = z.object({
  status: z.enum(RETURN_STATUSES, {error: 'Choose a return status'}),
  note: nullableText(2000).optional(),
});

type RefundOrder = OrderMoneyCents & {shippingCents: number; items: (LineMoneyCents & {sku: string; digital: boolean})[]};

/**
 * What refunding one return gives back (VAREL l.385–418): its lines (after discount, plus tax share),
 * plus shipping when this return completes the order (every physical line back through refunded
 * returns) and the store refunds shipping. Currency units; `restock` lists the physical lines to put back.
 */
export function returnRefundPlan(
  order: RefundOrder,
  items: ReturnItemJson[],
  otherRefunded: {items: Prisma.JsonValue}[],
  settings: {refundShipping: boolean; taxShipping: boolean; taxRate: number}
) {
  const back = unitsBack(otherRefunded);
  for (const it of items) back.set(it.lineId, (back.get(it.lineId) ?? 0) + it.qty);
  const allReturned = order.items.filter(l => !l.digital).every(l => (back.get(l.id) ?? 0) >= l.qty);
  const m = orderMoney(order);
  const linesAmount = items.reduce((n, it) => {
    const line = order.items.find(l => l.id === it.lineId);
    return n + (line ? lineRefund(m, lineMoney(line), it.qty) : 0);
  }, 0);
  const shipping = allReturned
    ? shippingRefund({shipping: fromCents(order.shippingCents), pricesIncludeTax: order.pricesIncludeTax, taxRate: m.taxRate}, settings)
    : 0;
  const restock = items.flatMap(it => {
    const line = order.items.find(l => l.id === it.lineId);
    return line ? [{sku: line.sku, qty: it.qty, digital: line.digital}] : [];
  });
  return {allReturned, linesAmount, asked: Math.round((linesAmount + shipping) * 100) / 100, restock};
}

/** Text of the event a status change writes ("Return approved · note"). */
export const returnEventMessage = (status: ReturnStatus, note?: string | null) =>
  clip([`Return ${status.toLowerCase()}`, ...(note ? [note] : [])].join(' · '), EVENT_MESSAGE_MAX);

/** Text of the refund event. */
export function returnRefundMessage(amountCents: number, currency: string, units: number, markedRefunded: boolean): string {
  const parts = [`Return refunded ${money(fromCents(amountCents), currency)}`, units ? `${plural(units, 'item')} restocked` : 'nothing to restock'];
  if (markedRefunded) parts.push('order marked refunded');
  return clip(parts.join(' · '), EVENT_MESSAGE_MAX);
}

const changedMeanwhile = () => conflict('CONFLICT', 'This return changed meanwhile. Reload and try again');

const guard = requirePermission(PERMISSIONS.SHOP_ORDER_MANAGE);

export const returnsAdmin = new Hono<Env>()
  .get('/', query(returnsListQuery), guard, withDb, async c => {
    const q = c.req.valid('query');
    const sort = parseSort(q.sort, RETURN_SORT_FIELDS, '-createdAt');
    if (!sort) return c.json(badSort(RETURN_SORT_FIELDS), 422);
    const size = q.pageSize ?? PAGE_SIZE;
    const words = searchWords(q.q);
    const where: Prisma.ReturnRequestWhereInput = {
      ...(q.status.length ? {status: {in: q.status}} : {}),
      ...(words.length
        ? {
            AND: words.map(w => ({
              OR: [
                {email: {contains: w, mode: 'insensitive' as const}},
                {order: {number: {contains: w, mode: 'insensitive' as const}}},
                ...(returnIdOf(w.replace(/^#/, '')) ? [{id: returnIdOf(w.replace(/^#/, ''))!}] : []),
              ],
            })),
          }
        : {}),
    };
    const after = decodeCursor(q.cursor);
    const at = after ? cursorDate(after[0]) : null;
    const keyset = after && at && typeof after[1] === 'number' ? keysetWhere('createdAt', sort.dir, [at, after[1]]) : {};
    const rows = await c.var.db.returnRequest.findMany({
      where: {AND: [where, keyset as Prisma.ReturnRequestWhereInput]},
      select: returnRowSelect,
      orderBy: orderByOf('createdAt', sort.dir) as Prisma.ReturnRequestOrderByWithRelationInput[],
      take: size + 1,
    });
    const page = keysetPage(rows, size, r => [r.createdAt, r.id]);
    c.header('Cache-Control', 'private, no-store');
    return c.json({items: page.items.map(r => adminReturnRow(r, r.order)), nextCursor: page.nextCursor} satisfies CursorPage<AdminReturnRow>);
  })

  .get('/:id', guard, withDb, async c => {
    const r = await loadReturn(c.var.db, c.req.param('id'));
    c.header('Cache-Control', 'private, no-store');
    return c.json(adminReturn(r));
  })

  .patch('/:id', json(returnPatch), guard, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const r = await loadReturn(db, c.req.param('id'));
    const current = r.status as ReturnStatus;
    if (current === 'Refunded' && input.status !== 'Refunded') {
      throw conflict('RETURN_CLOSED', 'This return has already been refunded');
    }
    const statusChanged = input.status !== current;
    if (statusChanged && !RETURN_NEXT[current].includes(input.status)) {
      throw conflict('RETURN_TRANSITION', `A ${current.toLowerCase()} return cannot be marked ${input.status.toLowerCase()}`);
    }
    if (statusChanged && input.status === 'Refunded' && r.order.payment === 'Refunded') {
      throw conflict('ORDER_REFUNDED', 'The whole order has already been refunded, so this return cannot be refunded again');
    }
    const by = actorName(c.var.viewer);
    const noteData = input.note !== undefined ? {note: input.note} : {};
    let refundAmountCents: number | undefined; // for the return_update email

    if (statusChanged && input.status === 'Refunded') {
      const [others, settings] = await Promise.all([
        db.returnRequest.findMany({
          where: {orderId: r.orderId, status: 'Refunded', id: {not: r.id}},
          select: {items: true},
          take: 50,
        }),
        getSettings(db),
      ]);
      const plan = returnRefundPlan(r.order, returnItems(r.items), others, settings);
      // Money first, outside the transaction (capped by the provider at what is left; idempotent per key,
      // so a retry after a failed write never refunds twice).
      const amountCents = await refundOrder(
        db,
        {id: r.orderId, number: r.order.number, paymentProvider: r.order.paymentProvider, currency: r.order.currency},
        toCents(plan.asked),
        `refund-return-${r.id}`
      );
      const now = Date.now();
      await db.$transaction(async tx => {
        const moved = await tx.returnRequest.updateMany({where: {id: r.id, status: current}, data: {status: 'Refunded', ...noteData}});
        if (!moved.count) throw changedMeanwhile();
        const units = await restockLines(tx, plan.restock);
        await tx.shopOrder.update({
          where: {id: r.orderId},
          data: {fulfillment: 'Returned', stage: 4, ...(plan.allReturned ? {payment: 'Refunded'} : {})},
          select: {id: true},
        });
        await tx.shopOrderEvent.createMany({
          data: [
            {orderId: r.orderId, kind: 'return', message: returnEventMessage('Refunded', input.note), by, at: new Date(now)},
            {
              orderId: r.orderId,
              kind: 'refund',
              message: returnRefundMessage(amountCents, r.order.currency, units, plan.allReturned && r.order.payment !== 'Refunded'),
              by,
              at: new Date(now + 1),
            },
          ],
        });
      });
      refundAmountCents = amountCents;
    } else {
      const event = statusChanged
        ? {kind: 'return', message: returnEventMessage(input.status, input.note)}
        : input.note !== undefined && input.note !== r.note
          ? {kind: 'note', message: clip(`Return note · ${input.note ?? 'cleared'}`, EVENT_MESSAGE_MAX)}
          : null;
      if (statusChanged || event) {
        await db.$transaction(async tx => {
          const moved = await tx.returnRequest.updateMany({where: {id: r.id, status: current}, data: {status: input.status, ...noteData}});
          if (!moved.count) throw changedMeanwhile();
          if (event) await tx.shopOrderEvent.create({data: {orderId: r.orderId, ...event, by}, select: {id: true}});
        });
      }
    }

    if (statusChanged) await sendReturnUpdate(c, db, r.id, {refundAmountCents});
    c.header('Cache-Control', 'private, no-store');
    return c.json(adminReturn(await loadReturn(db, String(r.id))));
  });
