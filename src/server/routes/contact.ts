import {Hono} from 'hono';
import {z} from 'zod';

import {withDb} from '../../platform/guards';
import {apiError} from '../lib/http';
import {rateLimit} from '../lib/rate-limit';
import {emailField, json} from '../lib/validate';

/**
 * Contact form. WP-07 (docs/migration/PLAN.md §5).
 * VAREL had no contact route (its /contact page is `mailto:` topics, kept as-is here); the
 * `ContactMessage` model existed for privacy export/erase. F3 declared the endpoint, so it stores a
 * message for the studio (read in the database / a later admin screen).
 *
 *   POST   /site-api/contact                           ContactInput → 204 (rate limited per email)
 *
 * The app-wide `sameOrigin` + `csrf` apply (callers use `siteFetch`). A filled honeypot (`website`)
 * answers 204 and stores nothing. No staff alert: VAREL has no such email template (hand-off note).
 */

/** At most this many messages from one address per window. */
const THROTTLE_MAX = 3;
const THROTTLE_MS = 10 * 60 * 1000;

const contactSchema = z.object({
  name: z.string({error: 'Enter your name'}).trim().min(1, 'Enter your name').max(120, 'Keep your name under 120 characters'),
  email: emailField,
  subject: z.string({error: 'Choose a topic'}).trim().min(1, 'Choose a topic').max(200, 'Keep the topic under 200 characters'),
  message: z.string({error: 'Write your message'}).trim().min(1, 'Write your message').max(5000, 'Keep your message under 5000 characters'),
  orderNumber: z
    .string()
    .trim()
    .max(20, 'Use the order number from your confirmation')
    .regex(/^[A-Z0-9-]*$/i, 'Use the order number from your confirmation')
    .nullish()
    .transform(v => (v ? v.toUpperCase() : null)),
  website: z.string().max(200).optional(),
});

/** Mounted at `/site-api/contact` (src/server/app.ts). */
export const contactRoutes = new Hono().post('/', json(contactSchema), withDb, async c => {
  const input = c.req.valid('json');
  if (input.website) return c.body(null, 204);
  const db = c.var.db;
  // Per IP (I2): the per-email throttle below is easy to dodge with a new address.
  await rateLimit(c, db, 'contact');
  const recent = await db.contactMessage.findMany({
    where: {email: input.email, createdAt: {gte: new Date(Date.now() - THROTTLE_MS)}},
    select: {id: true},
    take: THROTTLE_MAX,
  });
  if (recent.length >= THROTTLE_MAX) {
    c.header('Retry-After', String(THROTTLE_MS / 1000));
    return apiError(c, 429, 'too_many_requests', 'You have sent several messages. Try again in a few minutes.');
  }
  await db.contactMessage.create({
    data: {name: input.name, email: input.email, subject: input.subject, message: input.message, order: input.orderNumber},
    select: {id: true},
  });
  return c.body(null, 204);
});
