/* Search page state (WP-08): pure helpers shared by the page, the island and the unit tests
   (port of the derived values in VAREL src/pages/Search.tsx). No React, no DOM. */
import {categoryLink, href} from '../../lib/links';
import {slugify} from '../../lib/format';
import type {SearchTab} from '../../lib/search-params';
import type {SearchResponse} from '../../lib/types/catalog';

/** Labels: `catalog:search.tabs.<tab>` */
export const TABS: readonly SearchTab[] = ['all', 'products', 'categories', 'journal'];

/* Editorial suggestions — verbatim from the Search prototype. The chip label is `catalog:search.suggestions.<term>`;
   the query stays the English term the catalogue is searched by. */
export const SUGGESTIONS = ['wool', 'knitwear', 'outerwear', 'leather', 'stone', 'digital'] as const;

/** Longest term sent to the API (its validator answers 422 above this). */
export const MAX_TERM = 200;

/** The events beacon caps `query` at 120 characters. */
export const MAX_TRACKED_QUERY = 120;

export type CategoryHit = SearchResponse['categories'][number];

/** The trimmed, length-capped term the API is asked for (`''` = nothing to search). */
export const termOf = (q: string | null | undefined): string => (q ?? '').trim().slice(0, MAX_TERM);

export interface Sections {
  total: number;
  showP: boolean;
  showC: boolean;
  showJ: boolean;
  /** Results exist, but none in the selected tab. */
  tabEmpty: boolean;
}

/** Which sections the selected tab shows (tabs filter on the client; no new request). */
export function visibleSections(data: SearchResponse | null | undefined, tab: SearchTab): Sections {
  const p = data?.products.length ?? 0;
  const c = data?.categories.length ?? 0;
  const j = data?.posts.length ?? 0;
  const total = p + c + j;
  const showP = (tab === 'all' || tab === 'products') && p > 0;
  const showC = (tab === 'all' || tab === 'categories') && c > 0;
  const showJ = (tab === 'all' || tab === 'journal') && j > 0;
  return {total, showP, showC, showJ, tabEmpty: !!data && total > 0 && !showP && !showC && !showJ};
}

export type ResultLine =
  | {key: 'search.prompt'}
  | {key: 'search.searching'; vars: {term: string}}
  | {key: 'search.unavailable'}
  | {key: 'search.results'; vars: {count: number; term: string}};

/** The `aria-live` line above the results: prompt, searching, unavailable or "N results for …". */
export function resultLine(s: {term: string; loading: boolean; failed: boolean; hasData: boolean; total: number}): ResultLine {
  if (!s.term) return {key: 'search.prompt'};
  if (s.loading) return {key: 'search.searching', vars: {term: s.term}};
  if (s.failed && !s.hasData) return {key: 'search.unavailable'};
  return {key: 'search.results', vars: {count: s.total, term: s.term}};
}

/** `/search/?q=<raw>&tab=<tab>` in `locale`: blank `q` and `tab=all` are omitted; the raw text keeps its spaces. */
export function searchUrl(q: string | null | undefined, tab: SearchTab | null | undefined, locale?: string | null): string {
  return href('/search/', locale, {
    q: q && q.trim() ? q : undefined,
    tab: tab && tab !== 'all' ? tab : undefined,
  });
}

/** A category chip's link: the stored slugs when the API sent them, else slugify(English name) as VAREL did. */
export const categoryHref = (c: CategoryHit, locale?: string | null): string =>
  categoryLink(c.deptSlug || slugify(c.dept), c.categorySlug || slugify(c.category), locale);

/** The `search` analytics event for a settled term: lowercased, clipped for the beacon, total result count. */
export function searchEvent(term: string, total: number): {query: string; results: number} {
  return {query: term.toLowerCase().slice(0, MAX_TRACKED_QUERY), results: total};
}
