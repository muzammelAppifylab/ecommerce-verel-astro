import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {getRouteApi, Link} from '@tanstack/react-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {formatDate, photoUrl} from '../../../lib/format';
import type {AdminPostRow} from '../../../lib/types/admin/content';
import {type JournalListSearch, postCategoriesQuery, type PostSort, postsQuery} from '../../queries/journal';
import {pageCount, when} from '../../shared';
import {
  Button,
  buttonClass,
  Card,
  Checkbox,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  LoadMore,
  Notice,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
} from '../../ui';
import {PostRowMenu, PostsBulkBar, PostStatusBadge} from './JournalActions';

/** `/dashboard/journal`: port of VAREL `pages/admin/journal/JournalList.tsx` (keyset pages + Load more). */

const route = getRouteApi('/journal');
const EMPTY = new Set<string>();

type View = 'all' | 'published' | 'draft';
const VIEWS: {value: View; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'published', label: 'Published'},
  {value: 'draft', label: 'Drafts'},
];

/** A sortable column header: click toggles newest ⇄ oldest (VAREL DataTable `sortKey`). */
function SortHeader({label, field, sort, onSort}: {label: string; field: 'publishedAt' | 'updatedAt'; sort: PostSort; onSort: (s: PostSort) => void}) {
  const active = sort.replace(/^-/, '') === field;
  const desc = sort.startsWith('-');
  const next: PostSort = active && desc ? field : `-${field}`;
  return (
    <button
      type="button"
      className="journal-sort"
      data-active={active ? '' : undefined}
      aria-label={`Sort by ${label.toLowerCase()}, ${next.startsWith('-') ? 'newest first' : 'oldest first'}`}
      onClick={() => onSort(next)}>
      {label}
      <Icon name={active ? (desc ? 'chevron-down' : 'chevron-up') : 'chevrons-up-down'} size={14} />
    </button>
  );
}

export function JournalList() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const sort: PostSort = search.sort ?? '-updatedAt';
  const posts = useInfiniteQuery(postsQuery(search));
  const categories = useQuery(postCategoriesQuery);
  const rows = useMemo(() => posts.data?.pages.flatMap(p => p.items), [posts.data]);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const set = useCallback(
    (patch: Partial<JournalListSearch>) => void navigate({search: prev => ({...prev, ...patch}), replace: true, resetScroll: false}),
    [navigate]
  );
  const filtered = Boolean(search.q || search.status || search.category);

  // The search box writes `q` to the URL 300 ms after typing stops.
  const [q, setQ] = useState(search.q ?? '');
  const lastQ = useRef(search.q ?? '');
  useEffect(() => {
    if ((search.q ?? '') !== lastQ.current) {
      lastQ.current = search.q ?? '';
      setQ(search.q ?? '');
    }
  }, [search.q]);
  useEffect(() => {
    const next = q.trim();
    if (next === lastQ.current) return;
    const timer = window.setTimeout(() => {
      lastQ.current = next;
      set({q: next || undefined});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, set]);

  // Selection belongs to the list as shown: any filter or sort change starts fresh.
  const listKey = JSON.stringify(search);
  const [sel, setSel] = useState<{key: string; ids: Set<string>}>({key: listKey, ids: EMPTY});
  const selected = sel.key === listKey ? sel.ids : EMPTY;
  const setSelected = useCallback((ids: Set<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSelected(new Set()), [setSelected]);
  const selectedRows = (rows ?? []).filter(p => selected.has(p.slug));
  const allSelected = Boolean(rows?.length) && rows!.every(p => selected.has(p.slug));
  const toggle = (slug: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(slug);
    else next.delete(slug);
    setSelected(next);
  };

  const categoryOptions = [
    {value: '', label: 'All categories'},
    ...(categories.data?.map(c => ({value: c.name, label: c.name})) ?? []),
    ...(search.category && !categories.data?.some(c => c.name === search.category) ? [{value: search.category, label: search.category}] : []),
  ];

  const onSort = (s: PostSort) => set({sort: s === '-updatedAt' ? undefined : s});

  const columns: Column<AdminPostRow>[] = [
    {
      key: 'select',
      width: 'shrink',
      header: (
        <Checkbox
          label={<span className="visually-hidden">Select all loaded posts</span>}
          checked={allSelected}
          disabled={!rows?.length}
          onChange={on => setSelected(on ? new Set(rows?.map(p => p.slug)) : new Set())}
        />
      ),
      cell: p => <Checkbox label={<span className="visually-hidden">Select {p.title}</span>} checked={selected.has(p.slug)} onChange={on => toggle(p.slug, on)} />,
    },
    {
      key: 'title',
      header: 'Post',
      cell: p => (
        <div className="journal-post-cell">
          <span className="journal-thumb">
            {p.image?.src ? <img src={photoUrl(p.image, 80)} alt="" loading="lazy" /> : <Icon name="image-plus" size={16} />}
          </span>
          <span className="journal-post-text">
            <Link to="/journal/$slug" params={{slug: p.slug}} className="journal-post-title">
              {p.title}
            </Link>
            <span className="journal-post-path">/journal/{p.slug}/</span>
          </span>
        </div>
      ),
    },
    {key: 'category', header: 'Category', cell: p => <span className="muted">{p.category}</span>},
    {key: 'author', header: 'Author', hideOnMobile: true, cell: p => <span className="muted journal-nowrap">{p.author}</span>},
    {key: 'status', header: 'Status', width: 'shrink', cell: p => <PostStatusBadge post={p} />},
    {
      key: 'publishedAt',
      header: <SortHeader label="Published" field="publishedAt" sort={sort} onSort={onSort} />,
      width: 'shrink',
      cell: p => <span className="muted journal-nowrap">{formatDate(p.publishedAt) || '—'}</span>,
    },
    {
      key: 'updatedAt',
      header: <SortHeader label="Updated" field="updatedAt" sort={sort} onSort={onSort} />,
      width: 'shrink',
      hideOnMobile: true,
      cell: p => <span className="muted journal-nowrap">{when(p.updatedAt)}</span>,
    },
    {key: 'actions', header: 'Actions', actions: true, cell: p => <PostRowMenu post={p} onBusy={b => setBusySlug(b ? p.slug : null)} />},
  ];

  const hasNext = Boolean(posts.hasNextPage);
  const count = pageCount(rows, hasNext);

  return (
    <div className="app-page screen-journal">
      <PageHeader
        title="Journal"
        description={rows && count ? `${count} ${rows.length === 1 && !hasNext ? 'post' : 'posts'}` : 'Editorial posts on the storefront.'}
        actions={
          <Link to="/journal/new" className={buttonClass({variant: 'primary'})}>
            <Icon name="plus" size={18} />
            New post
          </Link>
        }
      />

      <div className="toolbar journal-toolbar">
        <div className="toolbar-group">
          <SegmentedControl label="Post views" options={VIEWS} value={search.status ?? 'all'} onChange={v => set({status: v === 'all' ? undefined : v})} />
          <form role="search" className="journal-search" noValidate onSubmit={e => e.preventDefault()}>
            <SearchInput
              label="Search posts"
              placeholder="Search title, excerpt or author"
              value={q}
              maxLength={200}
              autoComplete="off"
              onChange={e => setQ(e.target.value)}
            />
          </form>
          <span className="journal-category-filter">
            <label className="visually-hidden" htmlFor="journal-category">
              Category
            </label>
            <Select id="journal-category" options={categoryOptions} value={search.category ?? ''} onChange={e => set({category: e.target.value || undefined})} />
          </span>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              icon="x"
              onClick={() => {
                setQ('');
                lastQ.current = '';
                void navigate({search: {sort: search.sort}, replace: true});
              }}>
              Clear filters
            </Button>
          )}
        </div>
        {posts.isFetching && !posts.isLoading && !posts.isFetchingNextPage && <span className="muted journal-updating">Updating…</span>}
      </div>

      {posts.isError && !rows ? (
        <Notice
          tone="danger"
          title="Posts could not be loaded."
          action={
            <Button variant="secondary" size="sm" onClick={() => void posts.refetch()}>
              Try again
            </Button>
          }>
          {posts.error.message}
        </Notice>
      ) : (
        <Card flush>
          <DataTable
            caption="Journal posts"
            columns={columns}
            rows={rows}
            rowKey={p => p.slug}
            loading={posts.isLoading}
            busyKey={busySlug}
            empty={
              filtered ? (
                <EmptyState icon="search" title="No posts match these filters." />
              ) : (
                <EmptyState
                  icon="file-text"
                  title="No posts yet."
                  action={
                    <Link to="/journal/new" className={buttonClass({variant: 'secondary', size: 'sm'})}>
                      Write the first post
                    </Link>
                  }
                />
              )
            }
          />
        </Card>
      )}
      <LoadMore query={posts} />

      {/* Room for the floating bulk bar so it never covers Load more. */}
      {selectedRows.length > 0 && <div aria-hidden="true" className="journal-bulk-spacer" />}
      <PostsBulkBar
        rows={selectedRows}
        onClear={clear}
        onDone={slugs => setSelected(new Set([...selected].filter(s => !slugs.includes(s))))}
      />
    </div>
  );
}
