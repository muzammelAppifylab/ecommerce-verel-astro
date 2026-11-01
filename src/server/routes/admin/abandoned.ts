import {Hono} from 'hono';
import {z} from 'zod';

import {config} from '../../../platform/config';
import {withAuthCore, withDb} from '../../../platform/guards';
import type {AbandonedBulkResult, AbandonedList, AbandonedStatus} from '../../../lib/types/admin/merchandising';
import {runAbandonedReminders} from '../../jobs/abandoned-carts';
import {abandonedInclude, abandonedSettings, contactEmail, dismissed, sendReminder} from '../../lib/abandoned';
import {apiError} from '../../lib/http';
import {round2} from '../../lib/money';
import {intId, json, pageQuery, params, query} from '../../lib/validate';
import {
  ABANDONED_SORTS,
  ABANDONED_STATUSES,
  bagsByIds,
  latestOrders,
  olderBagIds,
  Prisma,
  recovered,
  rowOf,
  SCAN_LIMIT,
  scanBags,
  siblingsOf,
  sliceAfter,
  sortRows,
} from './abandoned-scan';

/**
 * Admin: Abandoned bags (port of VAREL worker/routes/admin/abandoned.ts).
 * VAREL `/api/admin/abandoned…` is `/site-api/manage/abandoned…` here.
 *
 *   GET    /site-api/manage/abandoned                  AbandonedList ?q&status&sort&cursor&pageSize
 *   POST   /site-api/manage/abandoned/run              AbandonedRunResult ("Send due reminders": the abandoned-carts job's body)
 *   POST   /site-api/manage/abandoned/bulk             {ids, action} → AbandonedBulkResult
 *   POST   /site-api/manage/abandoned/:id/remind       → AbandonedBagRow (the fresh row)
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: orders = `site:shop_order:manage`), then the activity log. Handlers add their validator,
 * then `withDb` (`withAuthCore` where a recovery link is signed).
 *
 * Differences from VAREL: the list derives its rows from the SCAN_LIMIT most recently active bags
 * (`capped` says when there are more) and pages them with a keyset cursor instead of page numbers.
 */

const PAGE_SIZE = 25;

const listQuery = z.object({
  q: z.string().trim().max(200).optional().default(''),
  status: z
    .enum(['all', ...ABANDONED_STATUSES], {error: 'Use all, active, abandoned, reminded, superseded or dismissed'})
    .optional()
    .default('all'),
  sort: z.enum(ABANDONED_SORTS, {error: 'Sort by lastActivity or value (prefix - for descending)'}).optional().default('-lastActivity'),
  ...pageQuery,
});

const bulkBody = z.object({
  ids: z
    .array(intId(), {error: 'Choose at least one bag'})
    .min(1, 'Choose at least one bag')
    .max(100, 'Choose at most 100 bags at a time'),
  action: z.enum(['remind', 'dismiss', 'restore'], {error: 'Use remind, dismiss or restore'}),
});

/** The origin a recovery link points at: the site's address, else this request's. */
const originOf = (url: string) => config.siteUrl ?? new URL(url).origin;

const noStore = {'Cache-Control': 'private, no-store'};

export const abandonedAdmin = new Hono()
  .get('/', query(listQuery), withDb, async c => {
    const q = c.req.valid('query');
    const db = c.var.db;
    const now = Date.now();
    const [settings, scan, rec] = await Promise.all([abandonedSettings(db), scanBags(db, {limit: SCAN_LIMIT}), recovered(db, now)]);
    const {bags, capped} = scan;
    const older = olderBagIds(bags);
    const orderedAt = await latestOrders(db, bags);
    const all = bags.map(bag => rowOf(bag, settings.hours, now, older, orderedAt(bag)));

    const bucket = (s: AbandonedStatus) => {
      const rows = all.filter(r => r.status === s);
      return {count: rows.length, value: round2(rows.reduce((n, r) => n + r.value, 0))};
    };
    const summary: AbandonedList['summary'] = {
      active: bucket('active'),
      abandoned: bucket('abandoned'),
      reminded: bucket('reminded'),
      superseded: bucket('superseded'),
      dismissed: bucket('dismissed'),
      ordered: bucket('ordered'),
      recovered: rec,
    };

    const words = q.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter(
      r =>
        // "All" is the bags that matter: dismissed, superseded and ordered ones have their own filters.
        (q.status === 'all' ? r.status !== 'dismissed' && r.status !== 'superseded' && r.status !== 'ordered' : r.status === q.status) &&
        words.every(w => `${r.email} ${r.customerName ?? ''} ${r.items.map(i => i.name).join(' ')}`.toLowerCase().includes(w))
    );
    const page = sliceAfter(sortRows(rows, q.sort), q.sort, q.cursor, q.pageSize ?? PAGE_SIZE);
    const out: AbandonedList & {capped?: boolean} = {
      ...page,
      settings: {enabled: settings.enabled, hours: settings.hours},
      summary,
      ...(capped ? {capped: true} : {}),
    };
    return c.json(out, 200, noStore);
  })

  .post('/run', withAuthCore, async c => {
    const result = await runAbandonedReminders(c.var.db, {origin: originOf(c.req.url), secret: c.var.secret, requestUrl: c.req.url});
    return c.json(result, 200, noStore);
  })

  .post('/bulk', json(bulkBody), withAuthCore, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const ids = [...new Set(input.ids)];
    const out: AbandonedBulkResult = {action: input.action, done: 0, skipped: {}};
    const skip = (k: keyof AbandonedBulkResult['skipped'], n = 1) => (out.skipped[k] = (out.skipped[k] ?? 0) + n);

    if (input.action !== 'remind') {
      // One statement; raw SQL leaves updated_at alone: it is the shopper's last activity, not ours.
      const at = input.action === 'dismiss' ? new Date() : null;
      const n = await db.$executeRaw`UPDATE "carts" SET "dismissed_at" = ${at} WHERE "id" IN (${Prisma.join(ids)})`;
      out.done = n;
      if (ids.length - n > 0) skip('missing', ids.length - n);
      return c.json(out, 200, noStore);
    }

    // Remind: one email per address (the newest bag), never a superseded or dismissed bag.
    const carts = await db.cart.findMany({where: {id: {in: ids}}, include: abandonedInclude, take: ids.length});
    const byId = new Map(carts.map(x => [x.id, x]));
    const siblings = await siblingsOf(db, carts);
    const older = olderBagIds([...carts, ...siblings]);
    const emailed = new Set<string>();
    const ctx = {db, origin: originOf(c.req.url), secret: c.var.secret};
    for (const id of ids) {
      const cart = byId.get(id);
      if (!cart) {
        skip('missing');
        continue;
      }
      if (older.has(id)) {
        skip('superseded');
        continue;
      }
      if (dismissed(cart)) {
        skip('dismissed');
        continue;
      }
      const to = contactEmail(cart)?.toLowerCase() ?? '';
      if (to && emailed.has(to)) {
        skip('duplicate');
        continue;
      }
      try {
        const outcome = await sendReminder(ctx, cart, {force: true});
        if (outcome === 'sent') {
          out.done++;
          emailed.add(to);
        } else skip(outcome);
      } catch (e) {
        console.error('[admin] bulk reminder failed', id, e instanceof Error ? e.message : 'unknown error');
        skip('error');
      }
    }
    return c.json(out, 200, noStore);
  })

  .post('/:id/remind', params(z.object({id: intId('We cannot find that bag')})), withAuthCore, async c => {
    const {id} = c.req.valid('param');
    const db = c.var.db;
    const cart = await db.cart.findUnique({where: {id}, include: abandonedInclude});
    if (!cart) return apiError(c, 404, 'not_found', 'We cannot find that bag');
    const outcome = await sendReminder({db, origin: originOf(c.req.url), secret: c.var.secret}, cart, {force: true});
    if (outcome === 'no-email') return apiError(c, 422, 'no_email', 'This bag has no email address to write to');
    if (outcome === 'empty') return apiError(c, 422, 'cart_empty', 'This bag is empty');
    if (outcome === 'ordered') return apiError(c, 409, 'order_placed', 'This shopper has placed an order since, so no reminder was sent');
    if (outcome === 'already-sent') return apiError(c, 409, 'already_sent', 'A reminder was just sent for this bag');
    // A reminder sent by hand brings a dismissed bag back (keeping the shopper's last activity).
    if (cart.dismissedAt) await db.$executeRaw`UPDATE "carts" SET "dismissed_at" = NULL WHERE "id" = ${cart.id}`;

    const [settings, [fresh]] = await Promise.all([abandonedSettings(db), bagsByIds(db, [cart.id])]);
    if (!fresh) return apiError(c, 404, 'not_found', 'We cannot find that bag');
    const siblings = await siblingsOf(db, [fresh]);
    const orderedAt = await latestOrders(db, [fresh]);
    return c.json(rowOf(fresh, settings.hours, Date.now(), olderBagIds([fresh, ...siblings]), orderedAt(fresh)), 200, noStore);
  });
