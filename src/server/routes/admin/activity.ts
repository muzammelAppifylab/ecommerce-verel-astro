import {Hono} from 'hono';
import {z} from 'zod';

import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import type {AdminActivityPage, AdminActivityRow} from '../../../lib/types/admin/staff';
import {audit} from '../../../platform/auth';
import {withDb} from '../../../platform/guards';
import type {Viewer} from '../../../platform/types';
import {csvCell, cursorDate, decodeCursor, encodeCursor} from '../../lib/http';
import {pageQuery, query} from '../../lib/validate';

/**
 * Admin: Activity log. WP-26 (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/activity.ts: VAREL `/api/admin/activity…` is `/site-api/manage/activity…` here.
 *
 *   GET    /site-api/manage/activity                   AdminActivityPage ?q&actor&entity&entityId&from&to&cursor&pageSize
 *   GET    /site-api/manage/activity/export.csv        CSV (VAREL /activity.csv), streamed, ≤ 10 000 rows
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: staff; MANAGE_AREAS in src/server/permissions.ts), then the activity log (which skips this path).
 *
 * Differences from VAREL: keyset pages (`nextCursor`, no total), the filter choices (actors, entities) only on
 * the first page and read with bounded skip-scans instead of `distinct` over the table, and the CSV streamed in
 * pages of 100 (never 10 000 rows in memory) and recorded in the audit log (an export).
 */

/** VAREL ACTIVITY_PAGE_SIZE. */
export const ACTIVITY_PAGE_SIZE = 50;
/** Rows per CSV page, and the most CSV pages (VAREL `take: 10_000`). */
export const CSV_PAGE = 100;
export const CSV_MAX_PAGES = 100;
/** At most this many search words (each ANDed). */
const MAX_WORDS = 8;

const DATE_MESSAGE = 'Use a date such as 2026-10-01';
/** `YYYY-MM-DD` (UTC midnight, as VAREL `new Date('YYYY-MM-DD')`) or a full ISO date; '' = not set. */
const dateParam = z
  .string()
  .trim()
  .max(40, DATE_MESSAGE)
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const d = new Date(v);
    if (!/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(d.getTime())) {
      ctx.addIssue({code: 'custom', message: DATE_MESSAGE});
      return z.NEVER;
    }
    return {date: d, bare: /^\d{4}-\d{2}-\d{2}$/.test(v)};
  });

/** The list's query (every key optional; the typed client sends '' for "any"). */
export const activityQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  actor: z
    .string()
    .trim()
    .optional()
    .refine(v => !v || /^[1-9]\d{0,9}$/.test(v), 'Choose someone from the list')
    .transform(v => (v ? Number(v) : undefined)),
  entity: z.string().trim().max(40, 'Choose a type from the list').optional(),
  entityId: z.string().trim().max(120, 'Use a valid id').optional(),
  from: dateParam,
  to: dateParam,
  cursor: pageQuery.cursor,
  pageSize: z
    .string()
    .trim()
    .optional()
    .refine(v => !v || (/^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 100), 'Use a page size from 1 to 100')
    .transform(v => (v ? Number(v) : undefined)),
});

export type ActivityFilters = z.output<typeof activityQuery>;

/** VAREL `whereOf`: every filter ANDed; each search word matches the summary or the actor's name. */
export function whereOf(f: Partial<ActivityFilters>): Prisma.ActivityLogWhereInput {
  const and: Prisma.ActivityLogWhereInput[] = [];
  if (f.actor) and.push({userId: f.actor});
  if (f.entity) and.push({entity: f.entity});
  if (f.entityId) and.push({entityId: f.entityId});
  if (f.from) and.push({createdAt: {gte: f.from.date}});
  if (f.to) and.push({createdAt: {lt: f.to.bare ? new Date(f.to.date.getTime() + 86_400_000) : f.to.date}});
  const words = (f.q ?? '').split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  for (const w of words) {
    and.push({OR: [{summary: {contains: w, mode: 'insensitive'}}, {actorName: {contains: w, mode: 'insensitive'}}]});
  }
  return and.length ? {AND: and} : {};
}

const rowSelect = {
  id: true,
  userId: true,
  actorName: true,
  action: true,
  entity: true,
  entityId: true,
  summary: true,
  createdAt: true,
} as const;

export type LogRow = Prisma.ActivityLogGetPayload<{select: typeof rowSelect}>;

const ORDER: Prisma.ActivityLogOrderByWithRelationInput[] = [{createdAt: 'desc'}, {id: 'desc'}];

/** Rows after the cursor's `(createdAt, id)`, newest first. A malformed cursor starts from the top. */
function afterCursor(cursor: string | undefined): Prisma.ActivityLogWhereInput | null {
  const values = decodeCursor(cursor);
  if (!values) return null;
  const at = cursorDate(values[0]);
  const raw = values[1];
  if (!at || typeof raw !== 'string' || !/^\d{1,19}$/.test(raw)) return null;
  const id = BigInt(raw);
  return {OR: [{createdAt: {lt: at}}, {createdAt: at, id: {lt: id}}]};
}

async function pageOf(db: PrismaClient, where: Prisma.ActivityLogWhereInput, cursor: string | undefined, size: number) {
  const after = afterCursor(cursor);
  const rows = await db.activityLog.findMany({
    where: after ? {AND: [where, after]} : where,
    select: rowSelect,
    orderBy: ORDER,
    take: size + 1,
  });
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return {
    rows: items,
    nextCursor: rows.length > size && last ? encodeCursor([last.createdAt, last.id.toString()]) : null,
  };
}

export const toRow = (r: LogRow): AdminActivityRow => ({
  id: r.id.toString(),
  at: r.createdAt.toISOString(),
  actor: {id: r.userId == null ? null : String(r.userId), name: r.actorName},
  action: r.action,
  entity: r.entity,
  entityId: r.entityId,
  summary: r.summary,
});

/** Everyone who has a row (skip-scan over `activity_logs(user_id, id)`, ≤ 100); current names win over the snapshot. */
async function actorsOf(db: PrismaClient): Promise<{id: string; name: string}[]> {
  const ids = await db.$queryRaw<{uid: number}[]>(Prisma.sql`
    WITH RECURSIVE a(uid) AS (
      (SELECT user_id FROM activity_logs WHERE user_id IS NOT NULL ORDER BY user_id LIMIT 1)
      UNION ALL
      SELECT (SELECT l.user_id FROM activity_logs l WHERE l.user_id > a.uid ORDER BY l.user_id LIMIT 1) FROM a WHERE a.uid IS NOT NULL
    )
    SELECT uid FROM a WHERE uid IS NOT NULL LIMIT 100`);
  const list = ids.map(r => Number(r.uid));
  if (!list.length) return [];
  const users = await db.user.findMany({where: {id: {in: list}}, select: {id: true, name: true, email: true}, take: 100});
  const names = new Map(users.map(u => [u.id, u.name.trim() || u.email]));
  return list
    .map(id => ({id: String(id), name: names.get(id) ?? `User ${id}`}))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every entity with a row (skip-scan over `activity_logs(entity, entity_id)`, ≤ 60), A–Z. */
async function entitiesOf(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRaw<{e: string}[]>(Prisma.sql`
    WITH RECURSIVE t(e) AS (
      (SELECT entity FROM activity_logs ORDER BY entity LIMIT 1)
      UNION ALL
      SELECT (SELECT l.entity FROM activity_logs l WHERE l.entity > t.e ORDER BY l.entity LIMIT 1) FROM t WHERE t.e IS NOT NULL
    )
    SELECT e FROM t WHERE e IS NOT NULL LIMIT 60`);
  return rows.map(r => r.e).sort((a, b) => a.localeCompare(b));
}

export const CSV_HEADER = ['Date', 'Staff', 'Action', 'Entity', 'Entity id', 'Summary'];
/** One CSV line (RFC 4180 + the formula guard; dates as ISO), CRLF-terminated. */
export const csvLine = (r: Pick<LogRow, 'createdAt' | 'actorName' | 'action' | 'entity' | 'entityId' | 'summary'>) =>
  [r.createdAt, r.actorName, r.action, r.entity, r.entityId, r.summary].map(csvCell).join(',') + '\r\n';

/** The names of the filters that are set (never their values: an actor or a search may name a person). */
const filterNames = (f: ActivityFilters) =>
  (['q', 'actor', 'entity', 'entityId', 'from', 'to'] as const).filter(k => f[k] !== undefined && f[k] !== '');

export const activityAdmin = new Hono<{Variables: {viewer: Viewer}}>()
  .get('/', query(activityQuery), withDb, async c => {
    const db = c.var.db;
    const f = c.req.valid('query');
    const size = f.pageSize ?? ACTIVITY_PAGE_SIZE;
    const first = !f.cursor;
    const [page, actors, entities] = await Promise.all([
      pageOf(db, whereOf(f), f.cursor, size),
      first ? actorsOf(db) : Promise.resolve([]),
      first ? entitiesOf(db) : Promise.resolve([]),
    ]);
    const body: AdminActivityPage = {items: page.rows.map(toRow), nextCursor: page.nextCursor, actors, entities};
    return c.json(body);
  })

  .get('/export.csv', query(activityQuery), withDb, async c => {
    const db = c.var.db;
    const f = c.req.valid('query');
    await audit(db, {
      actorUserId: c.var.viewer?.id ?? null,
      action: 'activity_exported',
      target: ['activity_log', 'csv'],
      ipHash: null,
      meta: {filters: filterNames(f)},
    });
    const where = whereOf(f);
    const encoder = new TextEncoder();
    let cursor: string | undefined;
    let pages = 0;
    let started = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(CSV_HEADER.map(csvCell).join(',') + '\r\n'));
          return;
        }
        try {
          const page = await pageOf(db, where, cursor, CSV_PAGE);
          pages += 1;
          if (page.rows.length) controller.enqueue(encoder.encode(page.rows.map(csvLine).join('')));
          cursor = page.nextCursor ?? undefined;
          if (!page.nextCursor || pages >= CSV_MAX_PAGES) controller.close();
        } catch (err) {
          console.error('[activity] export failed');
          controller.error(err);
        }
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="varel-activity-${day}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
