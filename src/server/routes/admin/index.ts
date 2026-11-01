import {Hono} from 'hono';
import {createMiddleware} from 'hono/factory';

import {getAccess} from '../../../platform/auth';
import {forbidden, requireAuth, withViewer} from '../../../platform/guards';
import {mayUseManage} from '../../permissions';
import {activityLog} from '../../lib/contracts';
import {abandonedAdmin} from './abandoned';
import {activityAdmin} from './activity';
import {analyticsAdmin} from './analytics';
import {collectionsAdmin} from './collections';
import {customersAdmin} from './customers';
import {dashboardAdmin} from './dashboard';
import {discountsAdmin} from './discounts';
import {emailsAdmin} from './emails';
import {inventoryAdmin} from './inventory';
import {menusAdmin} from './menus';
import {ordersAdmin} from './orders';
import {pagesAdmin} from './pages';
import {paymentsAdmin} from './payments';
import {postsAdmin} from './posts';
import {productsAdmin} from './products';
import {returnsAdmin} from './returns';
import {reviewsAdmin} from './reviews';
import {settingsAdmin} from './settings';
import {shippingAdmin} from './shipping';
import {staffAdmin} from './staff';
import {subscribersAdmin} from './subscribers';
import {taxRatesAdmin} from './tax-rates';
import {taxonomyAdmin} from './taxonomy';
import {translationsAdmin} from './translations';
import {uploadsAdmin} from './uploads';

/** Where this app is mounted (src/server/app.ts). */
export const MANAGE_BASE = '/site-api/manage';

/**
 * The central area check of VAREL's `/api/admin` (`adminPermissions`): the first path segment
 * under `/site-api/manage` names the area it needs (`MANAGE_AREAS`, src/server/permissions.ts),
 * reads may need less than writes. Permissions are re-read per request (memoized), never trusted
 * from the client. After `withViewer, requireAuth`; a signed-in customer gets 403.
 */
export const requireManageArea = createMiddleware(async (c, next) => {
  const {permissions} = await getAccess(c.req.raw);
  const path = c.req.path.startsWith(MANAGE_BASE) ? c.req.path.slice(MANAGE_BASE.length) : c.req.path;
  if (!mayUseManage(new Set(permissions), c.req.method, path)) return forbidden(c);
  await next();
});

/**
 * `/site-api/manage/*`: the store admin (VAREL `/api/admin/*`, worker/routes/admin/index.ts), used by
 * the portal (`/dashboard`, src/portal). Every module gets its own prefix (its file name), so a
 * module's `.use('*', …)` stays inside it. Every request: `withViewer → requireAuth →
 * requireManageArea → activityLog`; each handler then adds its validator and `withDb`.
 *
 * VAREL also switched the admin to the store's default locale (editors must never save translated
 * text as the source): admin handlers read and write SOURCE fields only and never call `localize`.
 *
 * Paths that moved (the rest keep their VAREL path under their area):
 *   /api/admin/departments…, /categories…   → /manage/taxonomy/departments…, /manage/taxonomy/categories…
 *   /api/admin/products/order               → /manage/collections/product-order
 *   /api/admin/inventory…                   → /manage/inventory…
 *   /api/admin/returns…                     → /manage/returns…
 *   /api/admin/orders.csv, subscribers.csv, activity.csv → /manage/<area>/export.csv
 *   /api/admin/uploads (multipart)          → /manage/uploads + /manage/uploads/:id/complete (platform files)
 *   /api/admin/staff/invites…               → dropped (D5: invite from the template's Users screen)
 */
export const manageRoutes = new Hono()
  .use('*', withViewer, requireAuth, requireManageArea, activityLog)
  .route('/dashboard', dashboardAdmin)
  .route('/analytics', analyticsAdmin)
  .route('/products', productsAdmin)
  .route('/inventory', inventoryAdmin)
  .route('/taxonomy', taxonomyAdmin)
  .route('/collections', collectionsAdmin)
  .route('/reviews', reviewsAdmin)
  .route('/uploads', uploadsAdmin)
  .route('/orders', ordersAdmin)
  .route('/returns', returnsAdmin)
  .route('/abandoned', abandonedAdmin)
  .route('/customers', customersAdmin)
  .route('/subscribers', subscribersAdmin)
  .route('/discounts', discountsAdmin)
  .route('/posts', postsAdmin)
  .route('/pages', pagesAdmin)
  .route('/menus', menusAdmin)
  .route('/translations', translationsAdmin)
  .route('/settings', settingsAdmin)
  .route('/tax-rates', taxRatesAdmin)
  .route('/shipping', shippingAdmin)
  .route('/payments', paymentsAdmin)
  .route('/emails', emailsAdmin)
  .route('/staff', staffAdmin)
  .route('/activity', activityAdmin);
