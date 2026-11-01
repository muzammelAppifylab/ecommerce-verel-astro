import {Hono} from 'hono';
import {z} from 'zod';

import {requireAuth, withDb, withViewer} from '../../platform/guards';
import type {Viewer} from '../../platform/types';
import type {
  PublicReview,
  ReviewEligibility,
  ReviewSort,
  ReviewStatus,
  ReviewSubmitResponse,
  ReviewSummary,
  ReviewsResponse,
} from '../../lib/types/reviews';
import type {Db} from '../lib/db';
import {HttpError, conflict, forbidden, notFound} from '../lib/errors';
import {rateLimit} from '../lib/rate-limit';
import {apiError, cursorDate, decodeCursor, encodeCursor, publicCache} from '../lib/http';
import {DELETED_NAME} from '../lib/privacy';
import {SETTINGS_ID} from '../lib/settings';
import {json, query, requiredText} from '../lib/validate';

/**
 * Product reviews (public). Port of VAREL worker/routes/reviews.ts (docs/PHASE2-3.md §8), WP-04.
 *
 *   GET    /site-api/products/:slug/reviews             ReviewsResponse ?sort&pageSize&cursor&page (public, cached 60 s)
 *   GET    /site-api/products/:slug/reviews/eligibility ReviewEligibility for the signed-in visitor (private)
 *   POST   /site-api/products/:slug/reviews             ReviewInput → 201 ReviewSubmitResponse (signed in, rate limited)
 *
 * Only signed-in customers with a PAID order containing the piece may review it, once per product.
 * Status follows `reviewsRequireApproval`; every change to approved reviews recomputes
 * `Product.ratingAvg` / `ratingCount` (`recomputeRating`, also used by the admin routes).
 *
 * Differences from VAREL: the list is keyset-paged (`nextCursor`; `page` is only echoed), orders and
 * reviews are matched by email only when the viewer's email is verified, an account may post at most
 * 10 reviews an hour, and an erased account's name (`DELETED_NAME`) is shown as it is.
 * Several public modules share the `/products` prefix: middleware sits on each route, never `.use('*')`.
 */

/** Product slugs are lower-case words joined by hyphens; anything else cannot be a product (no DB hit). */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const NOT_FOUND_MESSAGE = 'We cannot find that product';
const FALLBACK_NAME = 'VAREL customer';
/** Reviews one account may post in an hour (security.md: rate limits on writes). */
export const REVIEW_RATE_LIMIT = 10;

// ─── Helpers (exported: the admin routes and tests use them) ──────────────────

/** "Mira Holm" → "Mira H."; one word stays as it is; an erased account's name stays "Deleted customer". */
export function displayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === DELETED_NAME) return DELETED_NAME;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (!parts.length) return FALLBACK_NAME;
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

/** The columns a public review is built from (never email, userId or status). */
export const PUBLIC_SELECT = {
  id: true,
  name: true,
  rating: true,
  title: true,
  body: true,
  verifiedPurchase: true,
  reply: true,
  createdAt: true,
} as const;

export interface PublicReviewRow {
  id: number;
  name: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  reply: string | null;
  createdAt: Date;
}

export function serializeReview(r: PublicReviewRow): PublicReview {
  return {
    id: String(r.id),
    name: displayName(r.name),
    rating: r.rating,
    title: r.title,
    body: r.body,
    verifiedPurchase: r.verifiedPurchase,
    reply: r.reply,
    createdAt: r.createdAt.toISOString(),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recompute `Product.ratingAvg` / `ratingCount` from approved reviews. Call after every status change or delete. */
export async function recomputeRating(db: Db, productId: string): Promise<void> {
  const agg = await db.review.aggregate({
    where: {productId, status: 'approved'},
    _avg: {rating: true},
    _count: {_all: true},
  });
  const count = agg._count._all;
  await db.product.update({
    where: {id: productId},
    data: {ratingCount: count, ratingAvg: count ? round2(agg._avg.rating ?? 0) : null},
    select: {id: true},
  });
}

/** Average (2 dp), count and per-star distribution from `groupBy rating` rows. */
export function summarize(groups: readonly {rating: number; count: number}[]): ReviewSummary {
  const distribution: ReviewSummary['distribution'] = {'1': 0, '2': 0, '3': 0, '4': 0, '5': 0};
  let count = 0;
  let sum = 0;
  for (const g of groups) {
    const k = String(Math.min(5, Math.max(1, g.rating))) as keyof typeof distribution;
    distribution[k] += g.count;
    count += g.count;
    sum += g.rating * g.count;
  }
  return {avg: count ? round2(sum / count) : 0, count, distribution};
}

export async function summaryOf(db: Db, productId: string): Promise<ReviewSummary> {
  const groups = await db.review.groupBy({
    by: ['rating'],
    where: {productId, status: 'approved'},
    _count: {_all: true},
  });
  return summarize(groups.map(g => ({rating: g.rating, count: g._count._all})));
}

/** Review settings (columns on the settings row; defaults when the row is missing). Reviews are always
    limited to verified buyers; the old `reviewsVerifiedOnly` column is not read. */
export async function reviewSettings(db: Db): Promise<ReviewsResponse['settings']> {
  const s = await db.setting.findUnique({
    where: {id: SETTINGS_ID},
    select: {reviewsEnabled: true, reviewsRequireApproval: true},
  });
  return {
    enabled: s?.reviewsEnabled ?? true,
    requireApproval: s?.reviewsRequireApproval ?? true,
    verifiedOnly: true,
  };
}

/** A published product by slug, or a thrown 404 (unknown, draft or archived). */
export async function publishedProduct(db: Db, slug: string) {
  if (!SLUG_RE.test(slug)) throw notFound(NOT_FOUND_MESSAGE);
  const product = await db.product.findUnique({where: {id: slug}, select: {id: true, status: true}});
  if (!product || product.status !== 'published') throw notFound(NOT_FOUND_MESSAGE);
  return product;
}

/**
 * The one rule for writing a review: reviews open, signed in, not reviewed yet, a paid order containing
 * the piece. Guest orders (and reviews) carry only an email: they count only when the viewer's email is
 * verified, so nobody can register with a buyer's address and review as them.
 */
export async function eligibilityOf(db: Db, productId: string, viewer: Viewer | null, enabled: boolean): Promise<ReviewEligibility> {
  const no = (reason: ReviewEligibility['reason']): ReviewEligibility => ({canReview: false, reason});
  if (!enabled) return no('closed');
  if (!viewer || viewer.state !== 'user' || viewer.id === null) return no('signin');
  const email = (viewer.email ?? '').toLowerCase();
  const owner = viewer.emailVerified && email ? {OR: [{userId: viewer.id}, {email}]} : {userId: viewer.id};
  const [reviewed, purchase] = await Promise.all([
    db.review.findFirst({where: {productId, ...owner}, select: {id: true}}),
    db.shopOrder.findFirst({where: {payment: 'Paid', ...owner, items: {some: {productId}}}, select: {id: true}}),
  ]);
  if (reviewed) return no('reviewed');
  if (!purchase) return no('purchase');
  return {canReview: true, reason: 'ok'};
}

/** The full name a review is signed with: the customer profile's, else the account's (≤ 80 characters). */
export async function reviewerName(db: Db, viewer: Viewer): Promise<string> {
  const profile =
    viewer.id !== null
      ? await db.customerProfile.findUnique({where: {userId: viewer.id}, select: {firstName: true, lastName: true}})
      : null;
  const fromProfile = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
  return (fromProfile || viewer.name?.trim() || FALLBACK_NAME).slice(0, 80);
}

// ─── Keyset paging per sort ───────────────────────────────────────────────────

type Order = {rating?: 'asc' | 'desc'; createdAt?: 'desc'; id?: 'desc'};

export const SORT_ORDER: Record<ReviewSort, Order[]> = {
  newest: [{createdAt: 'desc'}, {id: 'desc'}],
  highest: [{rating: 'desc'}, {createdAt: 'desc'}, {id: 'desc'}],
  lowest: [{rating: 'asc'}, {createdAt: 'desc'}, {id: 'desc'}],
};

/** The cursor of the row a page ended on: `[createdAt, id]` (newest) or `[rating, createdAt, id]`. */
export function cursorOf(sort: ReviewSort, r: {rating: number; createdAt: Date; id: number}): string {
  return sort === 'newest' ? encodeCursor([r.createdAt, r.id]) : encodeCursor([r.rating, r.createdAt, r.id]);
}

/** Rows after the cursor's row, or `{}` (first page) when the cursor is absent or malformed. */
export function afterCursor(sort: ReviewSort, cursor: string | undefined): Record<string, unknown> {
  if (sort === 'newest') {
    const v = decodeCursor(cursor, 2);
    const at = v ? cursorDate(v[0]) : null;
    const id = v?.[1];
    if (!at || typeof id !== 'number') return {};
    return {OR: [{createdAt: {lt: at}}, {createdAt: at, id: {lt: id}}]};
  }
  const v = decodeCursor(cursor, 3);
  const rating = v?.[0];
  const at = v ? cursorDate(v[1]) : null;
  const id = v?.[2];
  if (typeof rating !== 'number' || !at || typeof id !== 'number') return {};
  return {
    OR: [
      {rating: {[sort === 'highest' ? 'lt' : 'gt']: rating}},
      {rating, createdAt: {lt: at}},
      {rating, createdAt: at, id: {lt: id}},
    ],
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(20).optional().default(5),
  sort: z.enum(['newest', 'highest', 'lowest']).optional().default('newest'),
  cursor: z.string().trim().max(512).optional(),
});

const RATING_RANGE = 'Choose a rating from 1 to 5';

export const submitBody = z.object({
  rating: z.coerce.number({error: 'Choose a rating'}).int(RATING_RANGE).min(1, RATING_RANGE).max(5, RATING_RANGE),
  title: requiredText('a title', 120),
  body: requiredText('your review', 2000).refine(s => s.length >= 10, 'Write at least a sentence or two'),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/** Mounted at `/site-api/products` (src/server/app.ts). */
export const reviewRoutes = new Hono()
  // Approved reviews + summary. Reads no visitor, so the answer is the same for everyone (cached 60 s).
  .get('/:slug/reviews', query(listQuery), withDb, async c => {
    const db = c.var.db;
    const {page, pageSize, sort, cursor} = c.req.valid('query');
    const slug = c.req.param('slug');
    const product = SLUG_RE.test(slug) ? await db.product.findUnique({where: {id: slug}, select: {id: true, status: true}}) : null;
    if (!product || product.status !== 'published') {
      c.header('Cache-Control', 'no-store');
      return apiError(c, 404, 'not_found', NOT_FOUND_MESSAGE);
    }
    const [summary, rows, settings] = await Promise.all([
      summaryOf(db, product.id),
      db.review.findMany({
        where: {productId: product.id, status: 'approved', ...afterCursor(sort, cursor)},
        orderBy: SORT_ORDER[sort],
        take: pageSize + 1,
        select: PUBLIC_SELECT,
      }),
      reviewSettings(db),
    ]);
    const items = rows.slice(0, pageSize);
    const last = items.at(-1);
    const out: ReviewsResponse = {
      summary,
      items: items.map(serializeReview),
      total: summary.count,
      page,
      pageSize,
      nextCursor: rows.length > pageSize && last ? cursorOf(sort, last) : null,
      settings,
    };
    publicCache(c, 60);
    return c.json(out, 200);
  })
  // Can the signed-in visitor review it? Drives the "Write a review" entry (private, per visitor).
  .get('/:slug/reviews/eligibility', withViewer, withDb, async c => {
    const db = c.var.db;
    const viewer = c.var.viewer;
    const product = await publishedProduct(db, c.req.param('slug'));
    const settings = await reviewSettings(db);
    // An expired access token: `siteFetch` refreshes once and retries (else a customer would see "sign in").
    if (settings.enabled && viewer.state === 'returning') {
      return apiError(c, 401, 'token_expired', 'Your session needs refreshing.');
    }
    const [verdict, name] = await Promise.all([
      eligibilityOf(db, product.id, viewer, settings.enabled),
      viewer.state === 'user' ? reviewerName(db, viewer) : Promise.resolve(null),
    ]);
    const out: ReviewEligibility = {...verdict, postingAs: name ? displayName(name) : null};
    return c.json(out, 200);
  })
  // Write a review: signed-in buyers of the piece only, once per product.
  .post('/:slug/reviews', json(submitBody), withViewer, requireAuth, withDb, async c => {
    const db = c.var.db;
    const viewer = c.var.viewer;
    const input = c.req.valid('json');
    // Attempts per account, failed ones too (I2); the 5-per-hour cap on posted reviews follows below.
    await rateLimit(c, db, 'review', {userId: viewer.id});
    const product = await publishedProduct(db, c.req.param('slug'));
    const settings = await reviewSettings(db);
    if (!settings.enabled) throw forbidden('Reviews are closed at the moment');

    const verdict = await eligibilityOf(db, product.id, viewer, settings.enabled);
    if (verdict.reason === 'signin') throw new HttpError(401, 'SIGNED_OUT', 'Sign in first.');
    if (verdict.reason === 'reviewed') throw conflict('ALREADY_REVIEWED', 'You have already reviewed this piece. Thank you');
    if (verdict.reason === 'purchase') throw new HttpError(403, 'VERIFIED_ONLY', 'Reviews are open to customers who bought this piece');

    const userId = viewer.id!;
    const [recent, name] = await Promise.all([
      db.review.findMany({
        where: {userId, createdAt: {gt: new Date(Date.now() - 60 * 60 * 1000)}},
        select: {id: true},
        take: REVIEW_RATE_LIMIT + 1,
      }),
      reviewerName(db, viewer),
    ]);
    if (recent.length >= REVIEW_RATE_LIMIT) throw new HttpError(429, 'RATE_LIMITED', 'Too many reviews. Try again in an hour.');

    const status: ReviewStatus = settings.requireApproval ? 'pending' : 'approved';
    const review = await db.review.create({
      data: {
        productId: product.id,
        userId,
        name,
        email: (viewer.email ?? '').toLowerCase().slice(0, 254),
        rating: input.rating,
        title: input.title,
        body: input.body,
        status,
        verifiedPurchase: true,
      },
      select: PUBLIC_SELECT,
    });
    if (status === 'approved') await recomputeRating(db, product.id);
    const out: ReviewSubmitResponse = {status, verifiedPurchase: true, review: status === 'approved' ? serializeReview(review) : null};
    return c.json(out, 201);
  });
