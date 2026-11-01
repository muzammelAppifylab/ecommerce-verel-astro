import {Hono} from 'hono';
import {z} from 'zod';

import {withDb} from '../../platform/guards';
import type {CollectionDetail, CollectionSummary} from '../../lib/types/collections';
import type {SitemapEntry} from '../../lib/types/common';
import {collectionBySlug, listCollections} from '../lib/collections';
import {notFound} from '../lib/errors';
import {publicCache} from '../lib/http';
import {locOf} from '../lib/i18n/localize';
import {query} from '../lib/validate';

/**
 * Collections (public). Port of VAREL worker/routes/collections.ts (+ the collection sitemap rows of
 * worker/routes/html.ts). Library: src/server/lib/collections.ts (F4).
 *
 *   GET    /site-api/collections                       CollectionSummary[] ?featured=true (src/lib/types/collections.ts)
 *   GET    /site-api/collections/sitemap               SitemapResponse: `/collections/<slug>/` of published collections
 *   GET    /site-api/collections/:slug                 CollectionDetail; 404 unless published
 *
 * Visitor-independent (no `withViewer`): answers are public and cached for 5 minutes (the sitemap
 * for an hour). The language comes from `X-Locale` / `?lang` / the locale cookie / Accept-Language
 * (`locOf`), so the cache varies on those. Collections are curated and small: no paging, at most
 * 100 collections and 100 products per collection.
 */

/** Slugs are lowercase words joined by single dashes, ≤ 120 characters (the admin's rule). */
export const COLLECTION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A URL slug as the lookup uses it (trimmed, lowercased), or null when it cannot be a collection's. */
export function normalizeCollectionSlug(raw: string | null | undefined): string | null {
  const slug = (raw ?? '').trim().toLowerCase();
  return slug && slug.length <= 120 && COLLECTION_SLUG_RE.test(slug) ? slug : null;
}

/** `?featured=true|false|1|0` (empty = all), VAREL's message. */
export const collectionListQuery = z.object({
  featured: z
    .enum(['true', 'false', '1', '0', ''], {error: 'Use featured=true or featured=false'})
    .optional()
    .transform(v => v === 'true' || v === '1'),
});

const LOCALE_VARY = 'X-Locale, Accept-Language, Cookie';

/** Mounted at `/site-api/collections` (src/server/app.ts). */
export const collectionRoutes = new Hono()
  .get('/', query(collectionListQuery), withDb, async c => {
    const {featured} = c.req.valid('query');
    const list: CollectionSummary[] = await listCollections(c.var.db, {featured}, await locOf(c));
    publicCache(c, 300);
    c.header('Vary', LOCALE_VARY);
    return c.json(list);
  })
  .get('/sitemap', withDb, async c => {
    const rows = await c.var.db.collection.findMany({
      where: {published: true},
      orderBy: [{position: 'asc'}, {id: 'asc'}],
      take: 100,
      select: {slug: true, updatedAt: true},
    });
    const items: SitemapEntry[] = rows.map(r => ({path: `/collections/${r.slug}/`, updatedAt: r.updatedAt.toISOString()}));
    publicCache(c, 3600);
    return c.json({items});
  })
  .get('/:slug', withDb, async c => {
    // Not a possible slug: 404 without a database read.
    const slug = normalizeCollectionSlug(c.req.param('slug'));
    if (!slug) throw notFound('We cannot find that collection');
    const collection: CollectionDetail | null = await collectionBySlug(c.var.db, slug, await locOf(c));
    if (!collection) throw notFound('We cannot find that collection');
    publicCache(c, 300);
    c.header('Vary', LOCALE_VARY);
    return c.json(collection);
  });
