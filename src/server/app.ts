import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';

import {isPreview} from '../platform/api';
import {adminRoutes, authRoutes, getAccess, getViewer, ownerClaimMode} from '../platform/auth';
import {config} from '../platform/config';
import {csrf, previewCookies, problem, sameOrigin} from '../platform/guards';
import {syncPermissions} from '../platform/permission-sync';
import {authSettings} from './auth-settings';
import {localizeFields, localizeMessage} from './lib/contracts';
import {toProblem} from './lib/http';
import {abilitiesFor, CATALOGUE} from './permissions';
import {accountRoutes} from './routes/account';
import {manageRoutes} from './routes/admin';
import {cartRoutes} from './routes/cart';
import {catalogRoutes, taxonomyRoutes} from './routes/catalog';
import {checkoutRoutes} from './routes/checkout';
import {collectionRoutes} from './routes/collections';
import {contactRoutes} from './routes/contact';
import {downloadRoutes} from './routes/downloads';
import {eventRoutes} from './routes/events';
import {accountLocaleRoutes, i18nRoutes} from './routes/i18n';
import {mediaRoutes} from './routes/media';
import {menuRoutes} from './routes/menus';
import {newsletterRoutes} from './routes/newsletter';
import {orderRoutes} from './routes/orders';
import {pageRoutes} from './routes/pages';
import {paymentWebhookRoutes} from './routes/payments-webhooks';
import {postRoutes} from './routes/posts';
import {productRoutes} from './routes/product';
import {returnRoutes} from './routes/returns';
import {reviewRoutes} from './routes/reviews';
import {searchRoutes} from './routes/search';
import {settingsRoutes} from './routes/settings';
import {countryRoutes, shippingRoutes} from './routes/shipping';
import {siteRoutes} from './routes/site';
import {wishlistRoutes} from './routes/wishlist';

/**
 * The Site API: this site's ONLY backend, one Hono app at `/site-api/*`.
 *
 * Everything reads and writes through it: the Astro pages call it IN-PROCESS
 * (`src/server/backend.ts`), the portal, the storefront islands and the `/account` pages call it
 * from the browser (`siteFetch` / the typed `hc` client, `src/portal/api.ts`).
 * Mounted by ONE catch-all page, `src/pages/site-api/[...path].ts`.
 *
 * The VAREL store (docs/migration/PLAN.md): VAREL's `/api/<path>` is `/site-api/<path>` here with
 * the same shapes (src/lib/types/*); its `/api/admin/<area>…` is `/site-api/manage/<area>…`.
 * Every slot below is a route module in `src/server/routes/` that its Wave 1 package fills in place.
 *
 *   GET  /health                 what this site has been given (booleans only)
 *   GET  /me                     the visitor + what the UI may show them (abilities)
 *   *    /auth/...               sign-up, sign-in, sessions, passwords   platform/auth/routes.ts
 *   *    /admin/...              users, roles, audit log (admins)        platform/auth/admin.ts
 *   GET  /site                   the site's brand                        routes/site.ts
 *   POST /webhooks/stripe        payment provider events (signed)        routes/payments-webhooks.ts
 *   GET  /settings/public        store settings for the storefront       routes/settings.ts
 *   GET  /menus                  navigation menus                        routes/menus.ts
 *   GET  /taxonomy, /products    departments, product lists              routes/catalog.ts
 *   GET  /products/:slug…        product detail, related, sitemap        routes/product.ts
 *   *    /products/:slug/reviews reviews                                 routes/reviews.ts
 *   GET  /collections…           collections                             routes/collections.ts
 *   GET  /search                 search                                  routes/search.ts
 *   GET  /posts…                 journal (+ sitemap, RSS feed)           routes/posts.ts
 *   GET  /pages…                 CMS pages (+ sitemap)                   routes/pages.ts
 *   POST /contact                contact form                            routes/contact.ts
 *   *    /cart…                  bag, bag discounts, abandoned recovery  routes/cart.ts
 *   *    /wishlist…              wishlist                                routes/wishlist.ts
 *   GET  /shipping…, /countries  zones, methods, countries               routes/shipping.ts
 *   *    /checkout…              checkout and payment (own provider, D3) routes/checkout.ts
 *   *    /orders…, /returns…     the customer's orders and returns       routes/orders.ts, returns.ts
 *   *    /account…               the customer's account                  routes/account.ts, i18n.ts
 *   GET  /i18n/catalog/…         UI string catalogs                      routes/i18n.ts
 *   GET  /downloads/:file        digital downloads                       routes/downloads.ts
 *   POST /events                 analytics beacon                        routes/events.ts
 *   POST /newsletter             newsletter sign-up                      routes/newsletter.ts
 *   GET  /media/:key             old VAREL media links (404)             routes/media.ts
 *   *    /manage/<area>/...      the store admin (staff, by area)        routes/admin/index.ts
 *
 * Routes are CHAINED so `AppType` carries every route to the typed client. Errors are JSON
 * `{error, message, fields?}`: a route answers them itself or throws (domain `HttpError`, zod,
 * Prisma) and `onError` maps it (src/server/lib/http.ts). `sameOrigin` + `csrf` refuse every
 * cross-site or token-less write; keep them, with `previewCookies` before them. The payment
 * webhooks are the one cross-site writer: mounted BEFORE them, authenticated by their signature.
 * Public modules share prefixes (`/products`, `/account`): they put middleware on each route,
 * never `.use('*')`.
 *
 * The template's one-price Buy button checkout (`/checkout` + `/memberships` on the platform's
 * payments) is not used (D3): VAREL's checkout owns `/checkout`.
 */
export const app = new Hono()
  .basePath('/site-api')
  // The editor Preview only: auth cookies carried in headers (its gateway drops cookies).
  .use(previewCookies)
  // Provider webhooks (Stripe): cross-site by nature, so BEFORE `sameOrigin` and `csrf`; each
  // handler verifies the provider's signature over the raw body first (WP-11).
  .route('/webhooks', paymentWebhookRoutes)
  .use(sameOrigin)
  .use(csrf)
  // No route here takes a big body; uploads never pass through the Worker.
  .use(bodyLimit({maxSize: 64 * 1024, onError: c => c.json(problem('too_large', 'That request is too large.'), 413)}))
  // New catalogue codenames reach the `permissions` table (once per isolate; no migration).
  .use(syncPermissions(CATALOGUE))
  // Answers are not cached unless a route says so (VAREL: `no-store` by default).
  .use(async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  })

  .get('/health', c =>
    c.json({
      ok: true,
      preview: isPreview(),
      database: Boolean(config.databaseUrl),
      auth: Boolean(config.jwtSecret && config.databaseUrl),
      siteKey: Boolean(config.siteKey),
      // false = the live site has no owner email, so nobody can become owner.
      ownerSetup: !authSettings.firstUserBecomesOwner || ownerClaimMode(authSettings) !== 'off',
    })
  )

  // `abilities` only decides what the UI SHOWS; every guarded route checks again.
  .get('/me', async c => {
    const [viewer, access] = await Promise.all([getViewer(c.req.raw), getAccess(c.req.raw)]);
    c.header('Cache-Control', 'private, no-store');
    // One flag per catalogue entry with an `ability` (src/server/permissions.ts).
    const abilities = abilitiesFor(new Set(access.permissions));
    return c.json({viewer, roles: access.roles, abilities});
  })

  .route('/auth', authRoutes(authSettings))
  .route('/admin', adminRoutes)
  .route('/site', siteRoutes)

  // ---- storefront (VAREL /api/*) ------------------------------------------------
  .route('/settings', settingsRoutes)
  .route('/menus', menuRoutes)
  .route('/taxonomy', taxonomyRoutes)
  .route('/products', catalogRoutes)
  .route('/products', productRoutes)
  .route('/products', reviewRoutes)
  .route('/collections', collectionRoutes)
  .route('/search', searchRoutes)
  .route('/posts', postRoutes)
  .route('/pages', pageRoutes)
  .route('/contact', contactRoutes)
  .route('/cart', cartRoutes)
  .route('/wishlist', wishlistRoutes)
  .route('/shipping', shippingRoutes)
  .route('/countries', countryRoutes)
  .route('/checkout', checkoutRoutes)
  .route('/orders', orderRoutes)
  .route('/returns', returnRoutes)
  .route('/account', accountRoutes)
  .route('/account', accountLocaleRoutes)
  .route('/i18n', i18nRoutes)
  .route('/downloads', downloadRoutes)
  .route('/events', eventRoutes)
  .route('/newsletter', newsletterRoutes)
  .route('/media', mediaRoutes)

  // ---- store admin (VAREL /api/admin/*) --------------------------------------
  .route('/manage', manageRoutes)

  .notFound(c => c.json(problem('not_found', 'No such Site API route.'), 404))
  .onError((err, c) => {
    const known = toProblem(err);
    if (!known) {
      // The message only: an error object can carry request details.
      console.error(`site-api ${c.req.method} ${c.req.path}: ${err.message}`);
      return c.json(problem('internal_error', 'Something went wrong on our side. Try again in a moment.'), 500);
    }
    // User-facing messages in the request language (English unchanged).
    const locale = (c.var as {locale?: string}).locale ?? c.req.header('x-locale');
    const body =
      locale && locale !== 'en'
        ? {...known.body, message: localizeMessage(locale, known.body.message), ...(known.body.fields ? {fields: localizeFields(locale, known.body.fields)} : {})}
        : known.body;
    return c.json(body, known.status);
  });

export type AppType = typeof app;
