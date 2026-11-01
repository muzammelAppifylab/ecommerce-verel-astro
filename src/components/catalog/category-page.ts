/* Server-side reads and decisions of a department / category page (VAREL src/pages/Category.tsx), called from
   the PAGE frontmatter (src/pages/shop/[dept]/index.astro, [dept]/[category]/index.astro) so the HTTP status
   (404 / 503) and the page context's `Cache-Control` are set before the response starts streaming; a child
   component's frontmatter runs too late for both. CategoryPage.astro renders the result.

   Reads, in parallel: page context ∥ taxonomy ∥ products (+ base listing). The products read needs only the
   route slugs, so it starts before the taxonomy answer; when the taxonomy says 404, it is discarded. */
import {dotJoin} from '@/lib/format';
import type {Department} from '@/lib/types/catalog';
import {backend, read} from '@/server/backend';
import {pageContext} from '@/server/page';

import {type CatalogListing, type ListingSearch, parseListingSearch, sortItems, sortOf, toApiQuery} from './listing';

/** Editorial copy per department slug (verbatim from the Category prototype): `catalog:category.copy.<slug>`. */
export const COPY_SLUGS = ['women', 'men', 'shoes', 'bags', 'accessories', 'lifestyle'];
/** Meta descriptions that differ from the copy: `catalog:category.meta.<slug>`. */
export const META_SLUGS = ['women'];

export type CategoryPageState = 'ready' | 'not-found' | 'unavailable';

export interface CategoryPageData {
  ctx: Awaited<ReturnType<typeof pageContext>>;
  state: CategoryPageState;
  deptSlug: string;
  catSlug?: string;
  search: ListingSearch;
  taxonomy: Department[] | null;
  dept: Department | undefined;
  category: Department['categories'][number] | undefined;
  /** The listing (name-sorted when asked); null when not ready or the read failed */
  list: CatalogListing | null;
}

interface PageAstro {
  request: Request;
  response: {status?: number; headers: Headers};
  url: URL;
}

export async function loadCategoryPage(astro: PageAstro, locale: string, deptSlug: string, catSlug?: string): Promise<CategoryPageData> {
  const search = parseListingSearch(astro.url.searchParams, 'category');
  const scope = {dept: deptSlug, category: catSlug};
  const api = backend(astro.request);
  const headers = {headers: {'x-locale': locale}};
  const [ctx, taxonomy, fetched] = await Promise.all([
    pageContext(astro.request, astro.response),
    read<Department[]>(api.taxonomy.$get({}, headers)),
    read<CatalogListing>(api.products.$get({query: toApiQuery(search, scope, catSlug ? 'category' : 'dept')} as never, headers)),
  ]);

  // Slugs match as given (VAREL: `d.slug === deptSlug`): an upper-case URL is a 404, not a redirect. A
  // category slug must belong to THAT department (`/shop/men/dresses/` is a 404).
  const dept = taxonomy?.find(d => d.slug === deptSlug);
  const category = catSlug ? dept?.categories.find(c => c.slug === catSlug) : undefined;
  const state: CategoryPageState = !taxonomy ? 'unavailable' : !dept || (catSlug && !category) ? 'not-found' : 'ready';
  const list = state === 'ready' ? fetched : null;
  // Never a 404 on an outage.
  if (state === 'unavailable') astro.response.status = 503;
  else if (state === 'not-found') astro.response.status = 404;
  else if (!list) astro.response.status = 503;
  if (list) list.items = sortItems(list.items, sortOf(search));

  return {ctx, state, deptSlug, catSlug, search, taxonomy, dept, category, list};
}

/** The page `<title>`: "Shirts · Women", "Women", or the not-found / error title. */
export function categoryTitle(data: CategoryPageData, tc: (key: string) => string): string {
  if (data.state === 'not-found') return tc('category.notFoundTitle');
  if (data.state === 'unavailable') return tc('results.errorTitle');
  const deptName = data.dept?.name ?? data.deptSlug;
  return data.category ? dotJoin(data.category.name, deptName) : deptName;
}
