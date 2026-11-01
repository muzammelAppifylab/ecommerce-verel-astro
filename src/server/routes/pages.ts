import {Hono} from 'hono';

import {BUILT_IN_PAGES, PAGE_SLUG, pagePath} from '../../components/pages/policy';
import type {SitemapEntry, SitemapResponse} from '../../lib/types/common';
import type {CmsPage, PostBlock} from '../../lib/types/content';
import {withDb} from '../../platform/guards';
import {apiError, publicCache} from '../lib/http';
import {loadFor, locOf, tr, trJson} from '../lib/i18n/localize';

/**
 * CMS pages (public). WP-07 (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/pages.ts (GET /pages/:slug) and the pages slice of worker/routes/html.ts
 * (sitemap). The public menus (`GET /menus`) are WP-01's `routes/menus.ts`; `menuItems()` lives in
 * `routes/admin/menus.ts`.
 *
 *   GET    /site-api/pages/sitemap                     SitemapResponse: published pages (`privacy`, `terms` at `/privacy/`, `/terms/`; others `/pages/<slug>/`)
 *   GET    /site-api/pages/:slug                       CmsPage; 404 unless published
 *
 * Both answers depend only on the URL and the `X-Locale` header (never the visitor), so they are
 * publicly cacheable; a 404 is never cached publicly (the page may be published a minute later).
 */

/** At most this many pages in the sitemap (pages are created in code: a handful). */
const SITEMAP_LIMIT = 100;

const notFound = (c: Parameters<typeof apiError>[0]) => apiError(c, 404, 'not_found', 'We cannot find that page');

/** Mounted at `/site-api/pages` (src/server/app.ts). */
export const pageRoutes = new Hono()
  .get('/sitemap', withDb, async c => {
    const rows = await c.var.db.page.findMany({
      where: {published: true},
      select: {slug: true, updatedAt: true},
      orderBy: {slug: 'asc'},
      take: SITEMAP_LIMIT,
    });
    const items: SitemapEntry[] = rows.map(r => ({path: pagePath(r.slug), updatedAt: r.updatedAt.toISOString()}));
    // Privacy and terms always exist on the storefront (built-in copy without a CMS page), VAREL html.ts.
    for (const slug of BUILT_IN_PAGES) {
      const path = pagePath(slug);
      if (!items.some(i => i.path === path)) items.push({path, updatedAt: null});
    }
    publicCache(c, 3600);
    return c.json({items} satisfies SitemapResponse);
  })
  .get('/:slug', withDb, async c => {
    const slug = c.req.param('slug');
    // A malformed slug is a URL that matches nothing: 404, never 422.
    if (slug.length > 120 || !PAGE_SLUG.test(slug)) return notFound(c);
    const db = c.var.db;
    const page = await db.page.findUnique({
      where: {slug},
      select: {id: true, slug: true, title: true, body: true, seoTitle: true, seoDescription: true, updatedAt: true, published: true},
    });
    if (!page || !page.published) return notFound(c);
    const m = await loadFor(db, await locOf(c), 'page', [String(page.id)]);
    const source = (Array.isArray(page.body) ? page.body : []) as unknown as PostBlock[];
    const body = trJson<unknown>(m, page.id, 'body', source);
    const out: CmsPage = {
      slug: page.slug,
      title: tr(m, page.id, 'title', page.title),
      body: Array.isArray(body) ? (body as PostBlock[]) : source,
      seoTitle: page.seoTitle == null ? null : tr(m, page.id, 'seoTitle', page.seoTitle),
      seoDescription: page.seoDescription == null ? null : tr(m, page.id, 'seoDescription', page.seoDescription),
      updatedAt: page.updatedAt.toISOString(),
    };
    publicCache(c, 300);
    c.header('Vary', 'X-Locale');
    return c.json(out);
  });
