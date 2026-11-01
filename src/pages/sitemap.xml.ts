import type {APIRoute} from 'astro';

import type {SitemapEntry, SitemapResponse} from '../lib/types/common';
import {absoluteUrl, xmlEscape as escape} from '../lib/seo';
import {backend, read} from '../server/backend';

/**
 * `/sitemap.xml`, rendered ON REQUEST and cached for an hour (VAREL worker/routes/html.ts
 * `/sitemap.xml`): the public pages in `src/pages/` (found automatically) and each public area's
 * own bounded list:
 *
 *   GET /site-api/taxonomy/sitemap      /shop/<dept>/, /shop/<dept>/<cat>/ (routes/catalog.ts, WP-02)
 *   GET /site-api/products/sitemap      /product/<slug>/        (routes/product.ts, WP-03)
 *   GET /site-api/collections/sitemap   /collections/<slug>/    (routes/collections.ts, WP-05)
 *   GET /site-api/posts/sitemap         /journal/<slug>/        (routes/posts.ts, WP-06)
 *   GET /site-api/pages/sitemap         /pages/<slug>/, /privacy/, /terms/ (routes/pages.ts, WP-07)
 *
 * Each answers `{items: [{path, updatedAt}]}` (`SitemapResponse`); an area not built yet answers
 * `{items: []}`. Language alternates (hreflang, D7) are added by WP-25 / I1.
 *
 * Never listed: sign-in pages, the account app, the dashboard, the API, the error pages and the
 * per-visitor pages (bag, checkout, wishlist, search, order confirmation). A new public dynamic
 * route (`[slug].astro`) is not found automatically: give its area a `/sitemap` route and read it
 * here. A page with `<Base noindex>` goes in EXCLUDE.
 */
export const prerender = false;

const EXCLUDE = new Set(['/404/', '/500/', '/cart/', '/checkout/', '/wishlist/', '/search/', '/styleguide/', '/thanks/']);
const PRIVATE = /^\/(account|dashboard|portal|site-api)(\/|$)/;

/** `./about.astro` → `/about/`, `./shop/index.astro` → `/shop/` (every page URL ends with `/`, like the canonical). */
const pagePaths = Object.keys(import.meta.glob('./**/*.astro'))
  .filter(file => !file.includes('['))
  .map(file => `/${file.slice(2).replace(/\.astro$/, '').replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/'))
  .filter(path => !PRIVATE.test(path) && !EXCLUDE.has(path))
  .sort();

/** Only paths on this site: an area's answer can never point the sitemap at another host. */
const isSitePath = (path: unknown): path is string => typeof path === 'string' && (path === '/' || /^\/[^/\\]/.test(path));

export const GET: APIRoute = async ({request}) => {
  const api = backend(request);
  const areas = await Promise.all([
    read<SitemapResponse>(api.taxonomy.sitemap.$get()),
    read<SitemapResponse>(api.products.sitemap.$get()),
    read<SitemapResponse>(api.collections.sitemap.$get()),
    read<SitemapResponse>(api.posts.sitemap.$get()),
    read<SitemapResponse>(api.pages.sitemap.$get()),
  ]);
  // One entry per path; an area's entry (it knows `updatedAt`) wins over the page glob's.
  const byPath = new Map<string, SitemapEntry>();
  for (const entry of [...pagePaths.map(path => ({path, updatedAt: null})), ...areas.flatMap(area => area?.items ?? [])]) {
    if (!isSitePath(entry.path)) continue;
    const known = byPath.get(entry.path);
    if (!known || (!known.updatedAt && entry.updatedAt)) byPath.set(entry.path, entry);
  }
  const entries = [...byPath.values()];
  const urls = entries.flatMap(({path, updatedAt}) => {
    const loc = absoluteUrl(path);
    const lastmod = typeof updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(updatedAt) ? updatedAt.slice(0, 10) : null;
    return loc ? [`  <url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`] : [];
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
  const complete = areas.every(Boolean);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // The same for everyone (no visitor data): kept an hour, but only a complete one: with an
      // area missing (a database outage, an area not built yet) a few minutes.
      'Cache-Control': complete ? 'public, max-age=3600' : 'public, max-age=300',
    },
  });
};
