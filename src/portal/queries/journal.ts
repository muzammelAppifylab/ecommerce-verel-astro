import {infiniteQueryOptions, type QueryClient, queryOptions} from '@tanstack/react-query';

import type {AdminPost, AdminPostInput, AdminPostRow, PostStatus} from '../../lib/types/admin/content';
import type {CursorPage} from '../../lib/types/common';
import type {PostCategory} from '../../lib/types/content';
import {api, ApiError, manage, read} from '../api';
import {meQuery} from '../queries';
import type {RawSearch} from './search-params';

/**
 * Journal posts (`/dashboard/journal`, `/new`, `/$slug`): port of VAREL src/lib/admin/content.ts (posts)
 * and src/pages/admin/journal/search.ts. WP-06 owns this file (`/site-api/manage/posts`).
 * Lists are keyset pages (`LoadMore`), so the page is not in the URL; the loaded pages live in the
 * query cache.
 */

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const POST_STATUSES = ['draft', 'published'] as const;
export const POST_SORTS = ['-updatedAt', 'updatedAt', '-publishedAt', 'publishedAt'] as const;
export type PostSort = (typeof POST_SORTS)[number];

export interface JournalListSearch {
  q?: string;
  status?: (typeof POST_STATUSES)[number];
  category?: string;
  sort?: PostSort;
}

export function validateJournalListSearch(s: RawSearch): JournalListSearch {
  const status = s.status === 'draft' || s.status === 'published' ? s.status : undefined;
  const sort = POST_SORTS.includes(s.sort as PostSort) ? (s.sort as PostSort) : undefined;
  return {q: text(s.q), status, category: text(s.category), sort};
}

export const POSTS_PAGE_SIZE = 25;

export const postKeys = {
  all: ['manage', 'posts'] as const,
  lists: ['manage', 'posts', 'list'] as const,
  list: (s: JournalListSearch) => ['manage', 'posts', 'list', {q: s.q, status: s.status, category: s.category, sort: s.sort}] as const,
  detail: (slug: string) => ['manage', 'posts', 'detail', slug] as const,
};

const postPath = (slug: string) => `posts/${encodeURIComponent(slug)}`;

/** `/dashboard/journal`: posts matching the search, 25 a page, newest edit first by default. */
export const postsQuery = (s: JournalListSearch) =>
  infiniteQueryOptions({
    queryKey: postKeys.list(s),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      manage<CursorPage<AdminPostRow>>('posts', {
        signal,
        query: {q: s.q, status: s.status, category: s.category, sort: s.sort, cursor: pageParam, pageSize: POSTS_PAGE_SIZE},
      }),
    getNextPageParam: last => last.nextCursor ?? undefined,
  });

/** One post for the editor (source fields). */
export const postQuery = (slug: string) =>
  queryOptions({
    queryKey: postKeys.detail(slug),
    queryFn: ({signal}) => manage<AdminPost>(postPath(slug), {signal}),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

/** The storefront's published categories (the category filter and the editor's suggestions). */
export const postCategoriesQuery = queryOptions({
  queryKey: ['posts', 'categories'],
  queryFn: () => read<PostCategory[]>(api.posts.categories.$get()),
  staleTime: 60_000,
});

/** Lists (and the storefront category cache) after a write; `lists`: not the open detail (after a delete it would 404). */
export function invalidatePosts(qc: QueryClient, lists = false) {
  void qc.invalidateQueries({queryKey: lists ? postKeys.lists : postKeys.all});
  void qc.invalidateQueries({queryKey: ['posts']});
  void qc.invalidateQueries({queryKey: ['manage', 'dashboard']});
}

export const createPost = (body: AdminPostInput) => manage<AdminPost>('posts', {method: 'POST', body});
export const updatePost = (slug: string, body: Partial<AdminPostInput>) => manage<AdminPost>(postPath(slug), {method: 'PATCH', body});
export const deletePost = (slug: string) => manage<null>(postPath(slug), {method: 'DELETE'});

/** Outcome of a bulk action: which items succeeded and which failed (with the reason). */
export interface BulkOutcome<T> {
  done: T[];
  failed: {key: string; error: unknown}[];
}

export async function settle<T>(keys: string[], run: (key: string) => Promise<T>): Promise<BulkOutcome<T>> {
  const settled = await Promise.allSettled(keys.map(run));
  const out: BulkOutcome<T> = {done: [], failed: []};
  settled.forEach((r, i) => (r.status === 'fulfilled' ? out.done.push(r.value) : out.failed.push({key: keys[i]!, error: r.reason})));
  return out;
}

/** Publish or move several posts to drafts (parallel PATCHes). */
export const setPostsStatus = (slugs: string[], status: PostStatus) => settle(slugs, slug => updatePost(slug, {status}));

/** Delete several posts (parallel DELETEs). */
export const deletePosts = (slugs: string[]) =>
  settle(slugs, async slug => {
    await deletePost(slug);
    return slug;
  });

/** Copy a post as a new draft: "Copy of …" with a free `<slug>-copy[-n]` slug (SEO fields not copied, VAREL). */
export async function duplicatePost(slug: string): Promise<AdminPost> {
  const src = await manage<AdminPost>(postPath(slug));
  const base = `${src.slug}-copy`.slice(0, 110).replace(/-+$/, '');
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    try {
      return await createPost({
        slug: candidate,
        title: `Copy of ${src.title}`.slice(0, 160),
        category: src.category,
        author: src.author,
        status: 'draft',
        publishedAt: null,
        excerpt: src.excerpt,
        image: src.image,
        body: src.body,
      });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
  }
  throw new ApiError('Too many copies of this post already exist.', 409);
}

export const loadPosts = async (queryClient: QueryClient, search: JournalListSearch): Promise<void> => {
  await Promise.all([queryClient.ensureInfiniteQueryData(postsQuery(search)), queryClient.ensureQueryData(postCategoriesQuery)]);
};

export const loadNewPost = async (queryClient: QueryClient): Promise<void> => {
  await Promise.all([queryClient.ensureQueryData(postCategoriesQuery), queryClient.ensureQueryData(meQuery)]);
};

export const loadPost = async (queryClient: QueryClient, slug: string): Promise<void> => {
  await Promise.all([queryClient.ensureQueryData(postQuery(slug)), queryClient.ensureQueryData(postCategoriesQuery)]);
};
