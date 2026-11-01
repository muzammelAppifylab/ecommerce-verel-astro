import {Hono} from 'hono';
import {z} from 'zod';

import {withDb, withViewer} from '../../platform/guards';
import {EVENT_TYPES} from '../../lib/types/events';
import {visitorIdOf} from '../lib/visitor';
import {json} from '../lib/validate';

/**
 * Analytics beacon (WP-16). Port of VAREL worker/routes/events.ts (docs/PHASE2-3.md §8, PLAN.md D11).
 *
 *   POST   /site-api/events                            EventBatch → 204 always (consent-gated in the browser)
 *
 * Body `{events: [{type, path?, productId?, query?, results?}]}` (1–20). The visitor (`session_id` = the
 * `visitor_id` cookie, set now when absent) and the user come from the request, never the body. Stored only
 * when `settings.analytics_enabled` (no row = on). Purchases are read from orders, so `purchase` is not
 * accepted. Unknown product ids are stored as null (the event is kept). Behind the app's `sameOrigin` + `csrf`
 * (the browser module sends with `siteFetch`, src/components/layout/analytics.ts). A database failure is
 * logged and still answers 204: the beacon never reads the answer.
 */

export const eventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  path: z.string().trim().max(300).optional(),
  productId: z.string().trim().min(1).max(120).optional(),
  query: z.string().trim().max(120).optional(),
  results: z.number().int().min(0).max(100_000).optional(),
});

export const batchSchema = z.object({
  events: z.array(eventSchema).min(1, 'Send at least one event').max(20, 'Send at most 20 events at a time'),
});

/** Mounted at `/site-api/events` (src/server/app.ts). */
export const eventRoutes = new Hono().post('/', json(batchSchema), withViewer, withDb, async c => {
  const {events} = c.req.valid('json');
  const db = c.var.db;
  const viewer = c.var.viewer;
  const sessionId = visitorIdOf(c);
  const userId = viewer.state === 'user' ? (viewer.id ?? null) : null;
  try {
    // Keep product ids honest: only ids that exist are stored (a bad id becomes a plain event).
    const ids = [...new Set(events.map(e => e.productId).filter((v): v is string => !!v))];
    const [settings, products] = await Promise.all([
      db.setting.findUnique({where: {id: 1}, select: {analyticsEnabled: true}}),
      ids.length ? db.product.findMany({where: {id: {in: ids}}, select: {id: true}, take: 20}) : Promise.resolve([]),
    ]);
    if (settings && !settings.analyticsEnabled) return c.body(null, 204);
    const known = new Set(products.map(p => p.id));
    await db.analyticsEvent.createMany({
      data: events.map(e => ({
        type: e.type,
        sessionId,
        userId,
        productId: e.productId && known.has(e.productId) ? e.productId : null,
        query: e.type === 'search' && e.query ? e.query.toLowerCase() : null,
        results: e.type === 'search' ? (e.results ?? null) : null,
        path: e.path ?? null,
      })),
    });
  } catch {
    console.error('[events] store failed');
  }
  return c.body(null, 204);
});
