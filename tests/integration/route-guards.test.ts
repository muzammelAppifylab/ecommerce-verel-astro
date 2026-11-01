import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {requireAuth} from '../../src/platform/guards';
import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * I2: a sweep over EVERY route the Site API registers (security.md › A01 "deny by default").
 *
 *  - every `/site-api/manage/*` route: a guest gets 401, a signed-in customer 403;
 *  - every storefront write a guest may reach is on the list below (a new unguarded write fails here);
 *  - no route answers 500 to junk input, signed out or as the owner (validators reject, never crash).
 *
 * Routes come from Hono's own registry (`app.routes`), so a route added later is swept too.
 */

type Route = {method: string; path: string};
type Entry = Route & {handler: unknown};

const entries = () => (app as unknown as {routes: Entry[]}).routes;

/** True when `requireAuth` runs before the handlers of this route (on the route or on a `use('*')` above it). */
function signedInOnly(r: Route): boolean {
  return entries().some(
    e =>
      e.handler === requireAuth &&
      ((e.path === r.path && (e.method === r.method || e.method === 'ALL')) ||
        (e.method === 'ALL' && e.path.endsWith('/*') && r.path.startsWith(e.path.slice(0, -1))))
  );
}

/** Storefront writes a GUEST may call (everything else that writes needs a session). */
const PUBLIC_WRITES = new Set([
  'POST /site-api/auth/*', // sign-in flows (managed core, own rate limits)
  'POST /site-api/contact',
  'POST /site-api/newsletter',
  'POST /site-api/events',
  'POST /site-api/returns/lookup',
  'POST /site-api/returns',
  'POST /site-api/webhooks/stripe', // signed by Stripe
  // The guest bag, wishlist and checkout (visitor cookie, VAREL parity).
  'POST /site-api/cart/*',
  'PATCH /site-api/cart/*',
  'PUT /site-api/cart/*',
  'DELETE /site-api/cart/*',
  'POST /site-api/cart',
  'DELETE /site-api/cart',
  'POST /site-api/wishlist/*',
  'POST /site-api/wishlist',
  'DELETE /site-api/wishlist/*',
  'POST /site-api/checkout/*',
  'POST /site-api/checkout',
  'PATCH /site-api/checkout/*',
  'PUT /site-api/checkout/*',
  'DELETE /site-api/checkout/*',
  'POST /site-api/checkout/start',
  'POST /site-api/orders/*', // guest order look-ups by number + token (WP-14), checked below
]);

function routes(): Route[] {
  const seen = new Set<string>();
  const out: Route[] = [];
  for (const r of entries()) {
    if (r.method === 'ALL' || r.path.endsWith('*') && !r.path.includes(':')) continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({method: r.method, path: r.path});
  }
  return out;
}

/** A concrete URL for a route pattern: `:id{[0-9]+}` → 1, `:slug` → x, `*` → x. */
function urlOf(path: string): string {
  return path
    .replace(/:([A-Za-z_]+)\{[^}]*\}/g, (_m, name: string) => (/id$|Id$|^n$|number/i.test(name) ? '1' : '1'))
    .replace(/:([A-Za-z_]+)/g, (_m, name: string) => (/id$|Id$/.test(name) ? '1' : 'x'))
    .replace(/\*/g, 'x');
}

function matches(list: Set<string>, method: string, path: string): boolean {
  if (list.has(`${method} ${path}`)) return true;
  for (const entry of list) {
    const [m, p] = entry.split(' ') as [string, string];
    if (m === method && p.endsWith('/*') && path.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

const isWrite = (m: string) => m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';

describe.skipIf(!DATABASE_URL)('every Site API route is guarded (integration, real Postgres)', () => {
  let owner: Browser;
  let customer: Browser;

  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.71');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.72');
    // The first account is the owner (template default); the customer stays a member.
    expect(await userId('customer@example.test')).toBeGreaterThan(0);
  }, 120_000);
  afterAll(() => db.$disconnect());

  it('finds the store admin and storefront routes', () => {
    const all = routes();
    expect(all.filter(r => r.path.startsWith('/site-api/manage/')).length).toBeGreaterThan(80);
    expect(all.length).toBeGreaterThan(150);
  });

  it('every /manage route: 401 signed out, 403 for a customer', async () => {
    const guest = new Browser(app, '203.0.113.73');
    const leaks: string[] = [];
    for (const r of routes().filter(x => x.path.startsWith('/site-api/manage/'))) {
      const url = urlOf(r.path);
      const body = isWrite(r.method) ? {} : undefined;
      const g = await guest.request(r.method, url, body);
      if (g.status !== 401) leaks.push(`guest ${r.method} ${url} → ${g.status}`);
      const m = await customer.request(r.method, url, body);
      if (m.status !== 403) leaks.push(`customer ${r.method} ${url} → ${m.status}`);
    }
    expect(leaks).toEqual([]);
  }, 300_000);

  it('a guest reaches only the listed storefront writes', async () => {
    const guest = new Browser(app, '203.0.113.74');
    expect(signedInOnly({method: 'POST', path: '/site-api/products/:slug/reviews'})).toBe(true);
    const open: string[] = [];
    for (const r of routes()) {
      if (!isWrite(r.method) || r.path.startsWith('/site-api/manage/') || r.path.startsWith('/site-api/admin/')) continue;
      if (matches(PUBLIC_WRITES, r.method, r.path)) continue;
      if (signedInOnly(r)) {
        // The validator may answer first (422, guard order), but a valid-looking call still needs a session.
        const res = await guest.request(r.method, urlOf(r.path), {});
        if (res.status < 400) open.push(`${r.method} ${r.path} → ${res.status} with requireAuth`);
        continue;
      }
      const res = await guest.request(r.method, urlOf(r.path), {});
      // 401/403 = refused by the handler itself; 501 = not built yet.
      if (![401, 403, 501].includes(res.status)) open.push(`${r.method} ${r.path} → ${res.status} (no requireAuth)`);
    }
    expect(open).toEqual([]);
  }, 300_000);

  it('no route answers 500 to junk input (guest and owner)', async () => {
    const guest = new Browser(app, '203.0.113.75');
    const junk = {id: 'x', ids: ['x', -1, 1e300], name: {$gt: ''}, __proto__: {admin: true}, email: 'not-an-email', amountCents: 'NaN'};
    const crashes: string[] = [];
    for (const r of routes()) {
      if (r.path.startsWith('/site-api/webhooks/')) continue; // signature first (payments-webhooks tests)
      const url = urlOf(r.path) + (r.method === 'GET' ? '?cursor=%%%&pageSize=-5&sort=;drop&q=' + 'x'.repeat(300) : '');
      for (const who of [guest, owner]) {
        const res = await who.request(r.method, url, isWrite(r.method) ? junk : undefined);
        if (res.status >= 500 && res.status !== 501 && res.status !== 503) {
          crashes.push(`${who === owner ? 'owner' : 'guest'} ${r.method} ${url.split('?')[0]} → ${res.status} ${String(res.json.error)}`);
        }
      }
    }
    expect(crashes).toEqual([]);
  }, 600_000);
});
