import type {Context} from 'hono';

import {config} from '../../platform/config';
import {subjectHash} from '../../platform/auth/keys';
import type {Db} from './db';
import {HttpError} from './errors';

/**
 * Rate limits for the store's own public writes (security.md › A06 "Limit what costs"). The
 * template's limiter (`login_attempts`) has a fixed set of kinds for sign-in; these live in our own
 * indexed table `rate_hits` (prisma/migrations/20261102090000_i2_rate_hits).
 *
 *   await rateLimit(c, db, 'contact');                    // per client IP (HMAC, never the raw IP)
 *   await rateLimit(c, db, 'export', {userId: me});       // per account
 *
 * Record first, then count (like the template's `takeAttempt`): parallel requests count each other.
 * Over the limit it THROWS `HttpError(429, 'RATE_LIMITED')` (app.onError answers it, with
 * `Retry-After`). Every read is bounded (`take: limit + 1`, index `(kind, subject, created_at)`).
 *
 * Pruning is bounded too: each hit removes this subject's expired rows of its kind, and about one
 * hit in fifty removes up to 500 rows older than a day, whoever they belong to. No schedule needed.
 */
export const RATE_LIMITS = {
  /** Review posts per account (WP-04 also caps 5/hour per account in its own table). */
  review: {limit: 10, windowMs: 60 * 60_000, message: 'Too many reviews. Try again in an hour.'},
  /** Newsletter sign-ups per IP. */
  newsletter: {limit: 10, windowMs: 60 * 60_000, message: 'Too many sign-ups from here. Try again later.'},
  /** Contact messages per IP. */
  contact: {limit: 5, windowMs: 60 * 60_000, message: 'Too many messages. Try again in an hour.'},
  /** Analytics beacons per IP (each carries a batch). */
  events: {limit: 120, windowMs: 60_000, message: 'Too many events. Slow down.'},
  /** Guest return lookups (order number + email) per IP: guessable, so tight. */
  returnsLookup: {limit: 10, windowMs: 15 * 60_000, message: 'Too many lookups. Try again in 15 minutes.'},
  /** Return requests filed per IP. */
  returnsCreate: {limit: 10, windowMs: 60 * 60_000, message: 'Too many return requests. Try again later.'},
  /** Guest download links opened per IP (the token is guessable only in theory; the cost is bandwidth). */
  download: {limit: 60, windowMs: 60 * 60_000, message: 'Too many downloads. Try again later.'},
  /** Personal-data exports per account. */
  export: {limit: 3, windowMs: 60 * 60_000, message: 'You have asked for your data a few times already. Try again in an hour.'},
  /** Order look-ups by number + email (order page, guest links, cancel) per IP: guessable, so tight. */
  orderLookup: {limit: 30, windowMs: 15 * 60_000, message: 'Too many look-ups. Try again in 15 minutes.'},
  /** Orders placed per IP (each one holds stock and may create a PaymentIntent). */
  checkout: {limit: 20, windowMs: 10 * 60_000, message: 'Too many checkout attempts. Try again in a few minutes.'},
  /** Settling / giving up a card payment from the browser (calls Stripe) per IP. */
  checkoutSync: {limit: 60, windowMs: 10 * 60_000, message: 'Too many payment checks. Try again in a few minutes.'},
  /** Catalogue searches per IP (each loads the catalogue). */
  search: {limit: 60, windowMs: 60_000, message: 'Too many searches. Try again in a minute.'},
  /** Abandoned-bag email captures per IP. */
  cartEmail: {limit: 10, windowMs: 60 * 60_000, message: 'Too many requests. Try again later.'},
} as const satisfies Record<string, {limit: number; windowMs: number; message: string}>;

export type RateKind = keyof typeof RATE_LIMITS;

const DAY_MS = 24 * 60 * 60_000;
const PRUNE_BATCH = 500;

/** The client IP Cloudflare saw (never `x-forwarded-for`: anyone can send that). */
const clientIp = (c: Context) => c.req.header('cf-connecting-ip') ?? 'local';

/** The HMAC subject for this request: the account when given, else the client IP. */
export async function rateSubject(c: Context, userId?: number | null): Promise<string> {
  const secret = config.jwtSecret;
  if (!secret) throw new HttpError(503, 'AUTH_NOT_CONFIGURED', 'This site is not set up yet.');
  return userId ? subjectHash(secret, 'email', `user:${userId}`) : subjectHash(secret, 'ip', clientIp(c));
}

/**
 * Counts one hit of `kind` for this request and throws 429 when the subject is over the limit.
 * `userId` limits per account (signed-in routes), otherwise per client IP.
 */
export async function rateLimit(c: Context, db: Db, kind: RateKind, opts: {userId?: number | null} = {}): Promise<void> {
  const policy = RATE_LIMITS[kind];
  const subject = await rateSubject(c, opts.userId);
  const now = Date.now();
  const since = new Date(now - policy.windowMs);

  await db.rateHit.create({data: {kind, subject}, select: {id: true}});
  const [recent] = await Promise.all([
    db.rateHit.findMany({
      where: {kind, subject, createdAt: {gt: since}},
      select: {createdAt: true},
      orderBy: {createdAt: 'asc'},
      take: policy.limit + 1,
    }),
    db.rateHit.deleteMany({where: {kind, subject, createdAt: {lte: since}}}),
  ]);
  if (Math.random() < 0.02) await pruneRateHits(db, new Date(now - DAY_MS));

  if (recent.length > policy.limit) {
    const oldest = recent[0]!.createdAt.getTime();
    const seconds = Math.max(1, Math.ceil((oldest + policy.windowMs - now) / 1000));
    c.header('Retry-After', String(seconds));
    throw new HttpError(429, 'RATE_LIMITED', policy.message);
  }
}

/** Removes up to 500 hits older than `before` (bounded: one indexed sub-select). */
export async function pruneRateHits(db: Db, before: Date): Promise<number> {
  return db.$executeRaw`DELETE FROM "rate_hits" WHERE "id" IN (SELECT "id" FROM "rate_hits" WHERE "created_at" < ${before} LIMIT ${PRUNE_BATCH})`;
}
