import type {QueryClient} from '@tanstack/react-query';

import type {RawSearch} from './search-params';

/** Journal posts (`/dashboard/journal`, `/new`, `/$slug`). WP-06 owns this file (`/site-api/manage/posts`). */

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 1 ? n : undefined;
};

export const POST_STATUSES = ['draft', 'published'] as const;
export const POST_SORTS = ['-updatedAt', 'updatedAt', '-publishedAt', 'publishedAt'] as const;
export type PostSort = (typeof POST_SORTS)[number];

export interface JournalListSearch {
  q?: string;
  status?: (typeof POST_STATUSES)[number];
  category?: string;
  sort?: PostSort;
  page?: number;
}

export function validateJournalListSearch(s: RawSearch): JournalListSearch {
  const status = s.status === 'draft' || s.status === 'published' ? s.status : undefined;
  const sort = POST_SORTS.includes(s.sort as PostSort) ? (s.sort as PostSort) : undefined;
  return {q: text(s.q), status, category: text(s.category), sort, page: int(s.page)};
}

/** WP-06 implements. */
export const loadPosts = (_queryClient: QueryClient, _search: JournalListSearch): Promise<void> => Promise.resolve();
/** WP-06 implements. */
export const loadNewPost = (_queryClient: QueryClient): Promise<void> => Promise.resolve();
/** WP-06 implements. */
export const loadPost = (_queryClient: QueryClient, _slug: string): Promise<void> => Promise.resolve();
