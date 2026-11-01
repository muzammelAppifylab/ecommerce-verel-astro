import {Hono} from 'hono';
import {z} from 'zod';

import {withDb} from '../../platform/guards';
import type {Db} from '../lib/db';
import {apiError} from '../lib/http';
import {rateLimit} from '../lib/rate-limit';
import {emailField, json, optionalText} from '../lib/validate';

/**
 * Newsletter sign-up (port of VAREL worker/routes/misc.ts `POST /newsletter`): VAREL `/api/newsletter`
 * is `/site-api/newsletter` here, same body (`NewsletterInput`, src/lib/types/account.ts).
 *
 *   POST   /site-api/newsletter                        NewsletterInput → 204 (idempotent, rate limited)
 *
 * Visitor-independent: no `withViewer`. The app-wide `sameOrigin`, `csrf` and body limit apply.
 * The same 204 answers a new and an existing address (no enumeration); an existing row keeps its
 * original `source` and date. A per-IP limit (`rateLimit` 'newsletter', I2) and a global flood guard refuse a burst.
 *
 * `subscribe` / `unsubscribe` are the writes every other writer of `newsletter_subscribers` should
 * reuse (checkout, account preferences, sign-up onboarding), so the subscriber row and the account's
 * `CustomerProfile.marketingOptIn` (VAREL `User.newsletter`) always move together.
 */

/** Sign-ups accepted from everyone together in one minute before answering 429. */
export const NEWSLETTER_FLOOD_LIMIT = 30;
const FLOOD_WINDOW_MS = 60_000;
export const FLOOD_MESSAGE = 'Too many sign-ups right now. Try again in a minute.';

/** Where the form was: `footer`, `journal`, `home`, `checkout`, `signup`, `account`… (lower-cased). */
export const newsletterSource = optionalText(40)
  .refine(s => s === null || /^[a-z0-9_-]+$/i.test(s), 'Use letters, digits, - or _')
  .transform(s => (s ? s.toLowerCase() : null));

export const newsletterBody = z.object({email: emailField, source: newsletterSource});

/** Subscribe `email` (already trimmed and lower-cased): upsert the row, never overwriting it, and set the account's opt-in. */
export async function subscribe(db: Db, email: string, source: string | null): Promise<void> {
  await db.newsletterSubscriber.upsert({where: {email}, create: {email, source}, update: {}, select: {id: true}});
  await db.customerProfile.updateMany({where: {user: {email}, marketingOptIn: false}, data: {marketingOptIn: true}});
}

/**
 * Unsubscribe `email`: delete the row AND clear the account's opt-in, or they would still count as a
 * subscriber (subscriber-only discounts read both). Returns how many subscriber rows were removed
 * (0 = the address was not on the list).
 */
export async function unsubscribe(db: Db, email: string): Promise<number> {
  const removed = await db.newsletterSubscriber.deleteMany({where: {email}});
  await db.customerProfile.updateMany({where: {user: {email}, marketingOptIn: true}, data: {marketingOptIn: false}});
  return removed.count;
}

/** Mounted at `/site-api/newsletter` (src/server/app.ts). */
export const newsletterRoutes = new Hono().post('/', json(newsletterBody), withDb, async c => {
  const {email, source} = c.req.valid('json');
  const db = c.var.db;
  await rateLimit(c, db, 'newsletter');
  const recent = await db.newsletterSubscriber.findMany({
    where: {createdAt: {gt: new Date(Date.now() - FLOOD_WINDOW_MS)}},
    select: {id: true},
    take: NEWSLETTER_FLOOD_LIMIT + 1,
  });
  if (recent.length > NEWSLETTER_FLOOD_LIMIT) {
    c.header('Retry-After', '60');
    return apiError(c, 429, 'rate_limited', FLOOD_MESSAGE);
  }
  await subscribe(db, email, source);
  c.header('Cache-Control', 'no-store');
  return c.body(null, 204);
});
