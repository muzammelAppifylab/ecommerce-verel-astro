import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import type {AdminSubscriber} from '../../../lib/types/admin/customers';
import {audit} from '../../../platform/auth';
import {withDb} from '../../../platform/guards';
import type {Db} from '../../lib/db';
import {apiError, csvCell, cursorDate, decodeCursor, encodeCursor, keysetPage, keysetWhere, orderByOf, pageSizeOf, parseSort, sortProblem, type Sort} from '../../lib/http';
import {pageQuery, params, query} from '../../lib/validate';
import {unsubscribe} from '../newsletter';

/**
 * Admin: Newsletter subscribers (port of VAREL worker/routes/admin/subscribers.ts): VAREL
 * `/api/admin/subscribers…` is `/site-api/manage/subscribers…` here.
 *
 *   GET    /site-api/manage/subscribers                CursorPage<AdminSubscriber> ?q&sort&cursor&pageSize
 *   GET    /site-api/manage/subscribers/export.csv     CSV (VAREL /subscribers.csv), at most 10,000 rows
 *   DELETE /site-api/manage/subscribers/:email         204; 404 not_subscribed
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: customers), then the activity log (`subscriber.delete`). VAREL's offset pages and totals are
 * keyset pages here (no `count()`); its `source` sort is dropped (no index, no screen used it).
 */

export const SUBSCRIBER_SORT_FIELDS = ['createdAt', 'email'] as const;
type SubscriberSortField = (typeof SUBSCRIBER_SORT_FIELDS)[number];

/** Rows per CSV page and the most pages one export reads (10,000 addresses). */
export const EXPORT_PAGE = 100;
export const EXPORT_MAX_PAGES = 100;

const listQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  sort: z.string().trim().max(40).optional(),
  ...pageQuery,
});

/** Search words (at most 5), each matching the email OR the source; words are ANDed (VAREL). */
export function subscriberWhere(q: string | undefined): Prisma.NewsletterSubscriberWhereInput {
  const words = (q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return {};
  return {
    AND: words.map(w => ({
      OR: [{email: {contains: w, mode: 'insensitive' as const}}, {source: {contains: w, mode: 'insensitive' as const}}],
    })),
  };
}

const subscriberSelect = {id: true, email: true, source: true, createdAt: true} as const;
type SubscriberRow = Prisma.NewsletterSubscriberGetPayload<{select: typeof subscriberSelect}>;

export const adminSubscriber = (s: SubscriberRow): AdminSubscriber => ({email: s.email, source: s.source, createdAt: s.createdAt.toISOString()});

const cursorOf = (sort: Sort<SubscriberSortField>, s: SubscriberRow) => [sort.field === 'email' ? s.email : s.createdAt, s.id] as const;

/** One keyset page of subscribers (`size + 1` rows: the extra one says there is more). */
async function subscriberPage(db: Db, where: Prisma.NewsletterSubscriberWhereInput, sort: Sort<SubscriberSortField>, cursor: string | undefined, size: number) {
  const after = decodeCursor(cursor);
  const value = after && (sort.field === 'createdAt' ? cursorDate(after[0]) : typeof after[0] === 'string' ? after[0] : null);
  const id = after && typeof after[1] === 'number' ? after[1] : null;
  const keyset = value !== null && value !== undefined && id !== null ? keysetWhere(sort.field, sort.dir, [value, id]) : {};
  return db.newsletterSubscriber.findMany({
    where: {AND: [where, keyset]},
    orderBy: orderByOf(sort.field, sort.dir),
    take: size + 1,
    select: subscriberSelect,
  });
}

const today = () => new Date().toISOString().slice(0, 10);

export const subscribersAdmin = new Hono()
  .get('/', query(listQuery), withDb, async c => {
    const q = c.req.valid('query');
    const sort = parseSort(q.sort, SUBSCRIBER_SORT_FIELDS, '-createdAt');
    if (!sort) return apiError(c, 422, 'invalid_input', 'Check the highlighted fields', sortProblem(SUBSCRIBER_SORT_FIELDS));
    const size = pageSizeOf(q.pageSize);
    const rows = await subscriberPage(c.var.db, subscriberWhere(q.q), sort, q.cursor, size);
    const page = keysetPage(rows, size, r => cursorOf(sort, r));
    return c.json({items: page.items.map(adminSubscriber), nextCursor: page.nextCursor});
  })

  .get('/export.csv', query(listQuery), withDb, async c => {
    const q = c.req.valid('query');
    const sort = parseSort(q.sort, SUBSCRIBER_SORT_FIELDS, '-createdAt');
    if (!sort) return apiError(c, 422, 'invalid_input', 'Check the highlighted fields', sortProblem(SUBSCRIBER_SORT_FIELDS));
    const db = c.var.db;
    const where = subscriberWhere(q.q);
    const viewer = (c.var as {viewer?: {id: number | null}}).viewer;
    await audit(db, {actorUserId: viewer?.id ?? null, action: 'subscribers_exported', target: ['newsletter', 'export'], meta: {filtered: Boolean(q.q)}});

    // Streamed one keyset page at a time: the Worker never holds the whole list.
    const encoder = new TextEncoder();
    let cursor: string | undefined;
    let pages = 0;
    let headerSent = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!headerSent) {
            headerSent = true;
            controller.enqueue(encoder.encode('Email,Source,Subscribed\r\n'));
            return;
          }
          const rows = await subscriberPage(db, where, sort, cursor, EXPORT_PAGE);
          const items = rows.slice(0, EXPORT_PAGE);
          pages++;
          if (items.length) {
            const text = items.map(s => [csvCell(s.email), csvCell(s.source), csvCell(s.createdAt)].join(',')).join('\r\n') + '\r\n';
            controller.enqueue(encoder.encode(text));
          }
          if (rows.length <= EXPORT_PAGE || pages >= EXPORT_MAX_PAGES) controller.close();
          else cursor = encodeCursor(cursorOf(sort, items.at(-1)!));
        } catch (err) {
          controller.error(err);
        }
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="varel-subscribers-${today()}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  })

  /** Remove a subscriber (unsubscribe on their behalf): the row and the account's opt-in. */
  .delete(
    '/:email',
    params(
      z.object({
        email: z
          .string()
          .trim()
          .toLowerCase()
          .min(3, 'Use an email address')
          .max(254, 'Use an email address')
          .refine(s => s.includes('@'), 'Use an email address'),
      })
    ),
    withDb,
    async c => {
      const {email} = c.req.valid('param');
      const removed = await c.var.db.$transaction(tx => unsubscribe(tx, email));
      if (!removed) return apiError(c, 404, 'not_subscribed', 'That address is not subscribed');
      return c.body(null, 204);
    }
  );
