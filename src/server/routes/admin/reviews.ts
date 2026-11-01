import {Hono} from 'hono';
import {z} from 'zod';

import {withDb} from '../../../platform/guards';
import type {Prisma} from '../../../generated/prisma/client';
import type {AdminReview, AdminReviewList, AdminReviewStatus} from '../../../lib/types/admin/reviews';
import type {Db} from '../../lib/db';
import {apiError, cursorDate, decodeCursor, encodeCursor} from '../../lib/http';
import {json, params, query} from '../../lib/validate';
import {recomputeRating} from '../reviews';

/**
 * Admin: review moderation. Port of VAREL worker/routes/admin/reviews.ts (docs/PHASE2-3.md §8), WP-04.
 *
 *   GET    /site-api/manage/reviews        AdminReviewList ?status&rating&verified&productId&q&cursor&pageSize
 *   POST   /site-api/manage/reviews/bulk   {ids, action: approve | reject | delete} → {updated}
 *   PATCH  /site-api/manage/reviews/:id    {status?, reply?} → AdminReview
 *   DELETE /site-api/manage/reviews/:id    204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products, `site:product:manage`), then the activity log. Every change keeps
 * `Product.ratingAvg` / `ratingCount` current. Admin text is English (never localized).
 *
 * Differences from VAREL: keyset pages (`nextCursor`) instead of page numbers and a total; the
 * per-status counts come from one grouped query (they ignore the status filter, honour the others);
 * bulk answers `{updated}` (VAREL `{count}`).
 */

const STATUSES = ['pending', 'approved', 'rejected'] as const;

export const ADMIN_SELECT = {
  id: true,
  productId: true,
  name: true,
  email: true,
  rating: true,
  title: true,
  body: true,
  status: true,
  verifiedPurchase: true,
  reply: true,
  createdAt: true,
  updatedAt: true,
  product: {
    select: {
      name: true,
      images: {orderBy: {position: 'asc' as const}, take: 1, select: {src: true, credit: true, creditHref: true}},
    },
  },
} satisfies Prisma.ReviewSelect;

type Row = Prisma.ReviewGetPayload<{select: typeof ADMIN_SELECT}>;

export function adminReview(r: Row): AdminReview {
  const img = r.product.images[0];
  return {
    id: String(r.id),
    productId: r.productId,
    productName: r.product.name,
    productImage: img ? {src: img.src, credit: img.credit, creditHref: img.creditHref} : null,
    name: r.name,
    email: r.email,
    rating: r.rating,
    title: r.title,
    body: r.body,
    status: (STATUSES as readonly string[]).includes(r.status) ? (r.status as AdminReviewStatus) : 'pending',
    verifiedPurchase: r.verifiedPurchase,
    reply: r.reply,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Recompute the rating of each product, ten at a time (bounded: at most 100 products per bulk). */
async function recomputeAll(db: Db, productIds: Iterable<string>) {
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 10) await Promise.all(ids.slice(i, i + 10).map(id => recomputeRating(db, id)));
}

const listQuery = z.object({
  status: z.enum([...STATUSES, 'all']).optional().default('all'),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  verified: z.enum(['true', 'false']).optional(),
  productId: z.string().trim().max(120).optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().trim().max(512).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const idParam = z.object({id: z.string()});
const ID_RE = /^[1-9][0-9]{0,9}$/;
/** A review id from the URL, or null (answered 404, as an unknown id). */
const reviewId = (raw: string): number | null => (ID_RE.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : null);

const patchBody = z
  .object({
    status: z.enum(STATUSES).optional(),
    reply: z.string().trim().max(1000, 'Keep the reply under 1000 characters').nullable().optional(),
  })
  .refine(v => v.status !== undefined || v.reply !== undefined, {message: 'Nothing to change', path: ['status']});

const bulkBody = z.object({
  ids: z
    .array(z.string().trim().regex(ID_RE, 'Select at least one review'), {error: 'Select at least one review'})
    .min(1, 'Select at least one review')
    .max(100, 'Select at most 100 reviews')
    .transform(ids => [...new Set(ids.map(Number))]),
  action: z.enum(['approve', 'reject', 'delete']),
});

const NOT_FOUND = 'We cannot find that review';

export const reviewsAdmin = new Hono()
  .get('/', query(listQuery), withDb, async c => {
    const db = c.var.db;
    const p = c.req.valid('query');
    const base: Prisma.ReviewWhereInput = {
      ...(p.rating ? {rating: p.rating} : {}),
      ...(p.verified ? {verifiedPurchase: p.verified === 'true'} : {}),
      ...(p.productId ? {productId: p.productId} : {}),
      ...(p.q
        ? {
            OR: [
              {title: {contains: p.q, mode: 'insensitive'}},
              {body: {contains: p.q, mode: 'insensitive'}},
              {name: {contains: p.q, mode: 'insensitive'}},
              {email: {contains: p.q, mode: 'insensitive'}},
              {product: {name: {contains: p.q, mode: 'insensitive'}}},
            ],
          }
        : {}),
    };
    // Oldest pending first is a queue; everything else reads newest first.
    const dir = p.status === 'pending' ? 'asc' : 'desc';
    const op = dir === 'asc' ? 'gt' : 'lt';
    const after = decodeCursor(p.cursor, 2);
    const at = after ? cursorDate(after[0]) : null;
    const afterId = after?.[1];
    const keyset: Prisma.ReviewWhereInput =
      at && typeof afterId === 'number' ? {OR: [{createdAt: {[op]: at}}, {createdAt: at, id: {[op]: afterId}}]} : {};
    const where: Prisma.ReviewWhereInput = {
      AND: [base, p.status !== 'all' ? {status: p.status} : {}, keyset],
    };
    const [rows, groups] = await Promise.all([
      db.review.findMany({
        where,
        orderBy: [{createdAt: dir}, {id: dir}],
        take: p.pageSize + 1,
        select: ADMIN_SELECT,
      }),
      db.review.groupBy({by: ['status'], where: base, _count: {_all: true}}),
    ]);
    const counts: AdminReviewList['counts'] = {all: 0, pending: 0, approved: 0, rejected: 0};
    for (const g of groups) {
      if ((STATUSES as readonly string[]).includes(g.status)) counts[g.status as AdminReviewStatus] = g._count._all;
      counts.all += g._count._all;
    }
    const page = rows.slice(0, p.pageSize);
    const last = page.at(-1);
    const out: AdminReviewList = {
      items: page.map(adminReview),
      nextCursor: rows.length > p.pageSize && last ? encodeCursor([last.createdAt, last.id]) : null,
      counts,
    };
    return c.json(out, 200);
  })
  .post('/bulk', json(bulkBody), withDb, async c => {
    const db = c.var.db;
    const {ids, action} = c.req.valid('json');
    const rows = await db.review.findMany({where: {id: {in: ids}}, select: {productId: true}, take: 100});
    const {count} =
      action === 'delete'
        ? await db.review.deleteMany({where: {id: {in: ids}}})
        : await db.review.updateMany({where: {id: {in: ids}}, data: {status: action === 'approve' ? 'approved' : 'rejected'}});
    await recomputeAll(db, rows.map(r => r.productId));
    return c.json({updated: count}, 200);
  })
  .patch('/:id', params(idParam), json(patchBody), withDb, async c => {
    const db = c.var.db;
    const id = reviewId(c.req.valid('param').id);
    if (id === null) return apiError(c, 404, 'not_found', NOT_FOUND);
    const input = c.req.valid('json');
    const data: Prisma.ReviewUpdateInput = {};
    if (input.status) data.status = input.status;
    if (input.reply !== undefined) data.reply = input.reply || null;
    const r = await db.review.update({where: {id}, data, select: ADMIN_SELECT}); // P2025 → 404 (app.onError)
    if (input.status) await recomputeRating(db, r.productId);
    return c.json(adminReview(r), 200);
  })
  .delete('/:id', params(idParam), withDb, async c => {
    const db = c.var.db;
    const id = reviewId(c.req.valid('param').id);
    if (id === null) return apiError(c, 404, 'not_found', NOT_FOUND);
    const r = await db.review.delete({where: {id}, select: {productId: true}}); // P2025 → 404
    await recomputeRating(db, r.productId);
    return c.body(null, 204);
  });
