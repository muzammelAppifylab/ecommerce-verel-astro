import type {APIRoute} from 'astro';

import {SITE} from '../content/site';
import type {Site} from '../lib/types';
import type {FeedResponse} from '../lib/types/content';
import type {PublicSettings} from '../lib/types/settings';
import {absoluteUrl, xmlEscape as escape} from '../lib/seo';
import {backend, read} from '../server/backend';

/**
 * `/rss.xml`: the journal as an RSS 2.0 feed (the 20 newest published posts), rendered ON
 * REQUEST from `GET /site-api/posts/feed` (routes/posts.ts, WP-06 fills it) and cached for an
 * hour. Every page links it from `<head>` (src/layouts/Base.astro). The posts live in the Site
 * Database now (the Markdown blog is gone, D12), so the feed is no longer prerendered.
 */
export const prerender = false;

const LIMIT = 20;

export const GET: APIRoute = async ({request}) => {
  const api = backend(request);
  const [feed, settings, brand] = await Promise.all([
    read<FeedResponse>(api.posts.feed.$get()),
    read<PublicSettings>(api.settings.public.$get()),
    read<{site: Site | null}>(api.site.$get()),
  ]);
  const name = settings?.storeName || brand?.site?.name || 'VAREL';
  const description = settings?.seoDescription || `The journal of ${name}.`;
  const posts = (feed?.items ?? []).slice(0, LIMIT);
  // Feed readers need absolute links; without a known address (dev, Preview) they stay site-relative.
  const link = (path: string) => absoluteUrl(path) ?? path;
  const self = absoluteUrl('/rss.xml');
  const date = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toUTCString();
  };
  const items = posts.map(post => {
    const url = link(`/journal/${encodeURIComponent(post.slug)}/`);
    const published = date(post.publishedAt);
    return [
      '    <item>',
      `      <title>${escape(post.title)}</title>`,
      `      <link>${escape(url)}</link>`,
      `      <guid isPermaLink="true">${escape(url)}</guid>`,
      `      <description>${escape(post.excerpt)}</description>`,
      ...(published ? [`      <pubDate>${published}</pubDate>`] : []),
      ...(post.author ? [`      <dc:creator>${escape(post.author)}</dc:creator>`] : []),
      ...(post.category ? [`      <category>${escape(post.category)}</category>`] : []),
      '    </item>',
    ].join('\n');
  });
  const newest = posts[0] ? date(posts[0].publishedAt) : null;
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escape(`${name} Journal`)}</title>`,
    `    <link>${escape(link('/journal/'))}</link>`,
    `    <description>${escape(description)}</description>`,
    `    <language>${escape(settings?.defaultLocale || SITE.lang)}</language>`,
    ...(self ? [`    <atom:link href="${escape(self)}" rel="self" type="application/rss+xml" />`] : []),
    ...(newest ? [`    <lastBuildDate>${newest}</lastBuildDate>`] : []),
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // The same for everyone; a short cache when the posts could not be read.
      'Cache-Control': feed ? 'public, max-age=3600' : 'public, max-age=300',
    },
  });
};
