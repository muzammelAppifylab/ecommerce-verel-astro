import {Hono} from 'hono';

import {notImplemented} from '../lib/http';

/**
 * Payment provider webhooks. WP-11 implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/webhooks.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   POST   /site-api/webhooks/stripe                   Stripe events (payment_intent.*, charge.refunded) → 200
 *
 * Mounted BEFORE `sameOrigin` and `csrf` (a provider posts cross-site): every handler verifies the
 * provider signature (`config.ownerSecret('STRIPE_WEBHOOK_SECRET')`) over the raw body BEFORE reading it.
 *
 * Wave 0 stub: every route answers 501 `not_implemented` (sitemap/feed routes answer `{items: []}`).
 * Replace each handler IN PLACE, keeping the method and path (the typed client and the pages rely on
 * them). Per route: validator (src/server/lib/validate.ts) → withViewer → requireAuth → … → withDb.
 * Several public modules share a mount prefix (`/products`, `/account`): never `.use('*')` here,
 * put middleware on each route. Static paths stay before `/:param` ones.
 */
/** Mounted at `/site-api/webhooks` (src/server/app.ts). */
export const paymentWebhookRoutes = new Hono()
  .post('/stripe', notImplemented);
