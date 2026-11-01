import {Hono} from 'hono';
import {z} from 'zod';

import {withDb} from '../../platform/guards';
import type {ShippingMethod, ShippingMethodsResponse, ShippingZonesResponse} from '../../lib/types/orders';
import {COUNTRIES} from '../lib/countries';
import {publicCache} from '../lib/http';
import {loadFor, locOf, tr, type TranslationMap} from '../lib/i18n/localize';
import {serverT} from '../lib/i18n/messages';
import {getSettings} from '../lib/settings';
import {allZones, serializeMethod, serializeZone, zoneForCountry} from '../lib/shipping';
import {query} from '../lib/validate';

/**
 * Shipping zones, methods and countries (public). Port of VAREL worker/routes/shipping.ts (WP-11).
 * VAREL `/api/<path>` is `/site-api/<path>` here, same shapes (src/lib/types/orders.ts).
 *
 *   GET    /site-api/shipping/zones                    ShippingZonesResponse
 *   GET    /site-api/shipping/methods                  ShippingMethodsResponse ?country= (default Denmark)
 *   GET    /site-api/countries                         string[]: the countries the store ships to
 *
 * Method names and details come in the request language (translations; the language travels in a
 * header or cookie, not the URL), so zone answers are cached `private`. The country list is static.
 */

const localized =
  (m: TranslationMap) =>
  (x: ShippingMethod): ShippingMethod => ({
    ...x,
    name: tr(m, x.id, 'name', x.name),
    detail: tr(m, x.id, 'detail', x.detail),
  });

const methodsQuery = z.object({country: z.string().trim().max(80).optional()});

/** Mounted at `/site-api/shipping` (src/server/app.ts). */
export const shippingRoutes = new Hono()
  .get('/zones', withDb, async c => {
    const db = c.var.db;
    const loc = await locOf(c);
    const [settings, zones] = await Promise.all([getSettings(db), allZones(db)]);
    const m = await loadFor(db, loc, 'shipping_method', zones.flatMap(z => z.methods.map(x => x.id)));
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({
      freeThreshold: settings.freeShippingThreshold,
      zones: zones.map(serializeZone).map(z => ({...z, methods: z.methods.map(localized(m))})),
    } satisfies ShippingZonesResponse);
  })
  .get('/methods', query(methodsQuery), withDb, async c => {
    const {country} = c.req.valid('query');
    const db = c.var.db;
    const loc = await locOf(c);
    const zone = await zoneForCountry(db, country || 'Denmark');
    const m = await loadFor(db, loc, 'shipping_method', zone.methods.map(x => x.id));
    c.header('Cache-Control', 'private, max-age=300');
    // Seeded zone names are translated; custom zone names fall back to themselves.
    return c.json({
      zone: serverT(loc.locale, `zone.${zone.name}`, {}, zone.name),
      methods: zone.methods.map(serializeMethod).map(localized(m)),
    } satisfies ShippingMethodsResponse);
  });

/** Mounted at `/site-api/countries` (src/server/app.ts). */
export const countryRoutes = new Hono().get('/', c => {
  publicCache(c, 86_400);
  return c.json(COUNTRIES);
});
