import {useInfiniteQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';

import {pluralize} from '../../../lib/format';
import {
  bulkReviews,
  invalidateReviews,
  reviewsQuery,
  type ReviewView,
  type ReviewsSearch,
} from '../../queries/reviews';
import {BulkAction, BulkBar, EmptyState, ErrorNote, LoadMore, LoadingBlock, PageHeader, SearchInput, Select, Tabs, Button, useConfirm, useToast} from '../../ui';
import {ReviewCard} from './ReviewCard';
import {ReviewSettings} from './ReviewSettings';

/**
 * `/dashboard/reviews`: the moderation queue. Port of VAREL `src/pages/admin/reviews/Reviews.tsx`:
 * status views with counts, search and rating filter, approve / reject / reply / delete per review,
 * bulk actions on the selection, and the two review settings. Keyset pages ("Load more") instead
 * of page numbers.
 */

const VIEWS: {value: ReviewView; label: string}[] = [
  {value: 'pending', label: 'Pending'},
  {value: 'approved', label: 'Approved'},
  {value: 'rejected', label: 'Rejected'},
  {value: 'all', label: 'All'},
];

const EMPTY_COPY: Record<ReviewView, string> = {
  pending: 'Nothing waiting for review. New reviews land here first.',
  approved: 'No approved reviews yet.',
  rejected: 'No rejected reviews.',
  all: 'No reviews yet.',
};

const RATING_OPTIONS = [{value: '', label: 'Any rating'}, ...[5, 4, 3, 2, 1].map(n => ({value: String(n), label: pluralize(n, 'star')}))];

const EMPTY_SET = new Set<string>();
type BulkActionName = 'approve' | 'reject' | 'delete';
const DONE: Record<BulkActionName, string> = {approve: 'approved', reject: 'rejected', delete: 'deleted'};

export function Reviews() {
  const search = useSearch({from: '/reviews'}) as ReviewsSearch;
  const navigate = useNavigate({from: '/reviews'});
  const status: ReviewView = search.status ?? 'pending';
  const list = useInfiniteQuery(reviewsQuery(search));
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const set = (patch: Partial<ReviewsSearch>) =>
    void navigate({search: (prev: ReviewsSearch) => ({...prev, ...patch}), replace: true, resetScroll: false});

  // Search submits on Enter (ui.md), not on every key.
  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => setQ(search.q ?? ''), [search.q]);
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    set({q: q.trim() || undefined});
  };

  // The selection belongs to one list: changing a filter clears it.
  const listKey = JSON.stringify(search);
  const [sel, setSel] = useState<{key: string; ids: Set<string>}>({key: listKey, ids: EMPTY_SET});
  const selected = sel.key === listKey ? sel.ids : EMPTY_SET;
  const setSelected = useCallback((ids: Set<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSelected(new Set()), [setSelected]);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const bulk = useMutation({
    mutationFn: bulkReviews,
    onSettled: () => invalidateReviews(queryClient),
  });
  const [bulkAction, setBulkAction] = useState<BulkActionName | null>(null);
  const runBulk = async (action: BulkActionName) => {
    setBulkAction(action);
    try {
      const {updated} = await bulk.mutateAsync({ids: [...selected], action});
      toast.success(`${pluralize(updated, 'review')} ${DONE[action]}`);
      clear();
    } finally {
      setBulkAction(null);
    }
  };
  const bulkApproveOrReject = (action: 'approve' | 'reject') =>
    runBulk(action).catch((e: unknown) => toast.danger(e instanceof Error ? e.message : 'That did not work. Try again.'));
  const bulkDelete = () =>
    void confirm({
      title: `Delete ${pluralize(selected.size, 'review')}?`,
      body: 'Deleted reviews are gone for good and leave the product rating. To hide a review but keep it, reject it instead.',
      confirmLabel: 'Delete',
      pendingLabel: 'Deleting…',
      action: () => runBulk('delete'),
    });

  const first = list.data?.pages[0];
  const counts = first?.counts;
  const items = list.data?.pages.flatMap(p => p.items) ?? [];
  const allSelected = items.length > 0 && items.every(r => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someSelected;
  }, [someSelected]);

  const filtered = Boolean(search.q || search.rating);

  return (
    <div className="screen-reviews">
      <PageHeader
        title="Reviews"
        description={counts ? `${pluralize(counts.pending, 'review')} waiting · ${counts.approved} live` : 'Product reviews waiting for approval, and the ones live on the store.'}
      />

      <ReviewSettings />

      <Tabs
        label="Review views"
        value={status}
        onChange={v => set({status: v === 'pending' ? undefined : v})}
        items={VIEWS.map(v => ({value: v.value, label: v.label, count: counts?.[v.value]}))}>
        <div className="toolbar reviews-toolbar">
          <div className="toolbar-group reviews-filters">
            <form role="search" onSubmit={submitSearch} className="reviews-search">
              <SearchInput
                label="Search reviews"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search review, product, name or email"
                maxLength={200}
              />
            </form>
            <Select
              aria-label="Rating"
              value={search.rating ? String(search.rating) : ''}
              onChange={e => set({rating: e.target.value ? Number(e.target.value) : undefined})}
              options={RATING_OPTIONS}
            />
          </div>
          <div className="toolbar-group">
            {list.isFetching && !list.isLoading && !list.isFetchingNextPage && <span className="muted reviews-updating">Updating…</span>}
            {items.length > 0 && (
              <label className="checkbox reviews-select-page">
                <input
                  ref={selectAll}
                  type="checkbox"
                  checked={allSelected}
                  onChange={e => setSelected(e.target.checked ? new Set(items.map(r => r.id)) : new Set())}
                />
                <span className="checkbox-label">Select page</span>
              </label>
            )}
          </div>
        </div>

        {list.isError && !list.data ? (
          <div className="reviews-error">
            <ErrorNote error={list.error} title="Reviews could not be loaded" />
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </div>
        ) : list.isLoading ? (
          <LoadingBlock rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="star"
            title={filtered ? 'No reviews match these filters.' : EMPTY_COPY[status]}
            action={
              filtered ? (
                <Button variant="secondary" onClick={() => set({q: undefined, rating: undefined})}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="reviews-list">
            {items.map(r => (
              <ReviewCard key={r.id} review={r} selected={selected.has(r.id)} onSelect={on => toggle(r.id, on)} />
            ))}
          </ul>
        )}

        <LoadMore query={list} />
      </Tabs>

      {selected.size > 0 && <div aria-hidden="true" className="reviews-bulk-spacer" />}
      <BulkBar count={selected.size} noun={['review', 'reviews']} onClear={clear}>
        <BulkAction
          icon="check"
          onClick={() => void bulkApproveOrReject('approve')}
          pending={bulkAction === 'approve'}
          pendingLabel="Approving…"
          disabled={bulk.isPending}>
          Approve
        </BulkAction>
        <BulkAction
          icon="x"
          onClick={() => void bulkApproveOrReject('reject')}
          pending={bulkAction === 'reject'}
          pendingLabel="Rejecting…"
          disabled={bulk.isPending}>
          Reject
        </BulkAction>
        <BulkAction icon="trash" danger onClick={bulkDelete} pending={bulkAction === 'delete'} pendingLabel="Deleting…" disabled={bulk.isPending}>
          Delete
        </BulkAction>
      </BulkBar>
    </div>
  );
}
