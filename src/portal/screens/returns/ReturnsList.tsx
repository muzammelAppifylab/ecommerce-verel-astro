import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {type FormEvent, useCallback, useEffect, useMemo, useState} from 'react';

import type {AdminReturnRow, ReturnStatus} from '../../../lib/types/admin/sales';
import {navCountsQuery} from '../../queries/overview';
import {type ReturnsSearch, returnsListQuery} from '../../queries/returns';
import {pageCount} from '../../shared';
import {Button, type Column, DataTable, EmptyState, LoadMore, PageHeader, SearchInput, Tabs} from '../../ui';
import {formatDateTime, LoadFailed, money, selectColumn, Status} from '../orders/ui';
import {ReturnRowMenu, ReturnsBulkBar} from './actions';

/** Status views. "Requested" is the queue to work through, so it carries the live count. */
const VIEWS: {key: string; label: string; status?: ReturnStatus[]}[] = [
  {key: 'all', label: 'All'},
  {key: 'requested', label: 'Requested', status: ['Requested']},
  {key: 'approved', label: 'Approved', status: ['Approved']},
  {key: 'received', label: 'Received', status: ['Received']},
  {key: 'refunded', label: 'Refunded', status: ['Refunded']},
  {key: 'rejected', label: 'Rejected', status: ['Rejected']},
];
const EMPTY = new Set<string>();

const EMPTY_COPY: Record<string, string> = {
  requested: 'No returns waiting for review.',
  approved: 'No approved returns on their way back.',
  received: 'Nothing received is waiting for a refund.',
};

/** `/dashboard/returns` (VAREL src/pages/admin/returns/ReturnsList.tsx). */
export function ReturnsList() {
  const search = useSearch({from: '/returns'});
  const navigate = useNavigate({from: '/returns'});
  const list = useInfiniteQuery(returnsListQuery(search));
  const pendingCount = useQuery(navCountsQuery).data?.pendingReturns;
  const rows = useMemo(() => list.data?.pages.flatMap(p => p.items) ?? [], [list.data]);

  const set = (patch: Partial<ReturnsSearch>) =>
    void navigate({search: prev => ({...prev, ...patch}), replace: true, resetScroll: false});
  const view = VIEWS.find(v => (v.status ?? []).join() === (search.status ?? []).join());

  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => setQ(search.q ?? ''), [search.q]);
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    set({q: q.trim() || undefined});
  };

  // Selection belongs to the list as shown: filter changes start fresh.
  const listKey = JSON.stringify(search);
  const [sel, setSel] = useState<{key: string; ids: Set<string>}>({key: listKey, ids: EMPTY});
  const selected = sel.key === listKey ? sel.ids : EMPTY;
  const setSelected = useCallback((ids: Set<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSelected(new Set()), [setSelected]);
  const selectedRows = rows.filter(r => selected.has(r.id));
  const [busy, setBusy] = useState<string | null>(null);

  const columns: Column<AdminReturnRow>[] = [
    selectColumn({rows, keyOf: r => r.id, labelOf: r => `return #${r.id}`, selected, onChange: setSelected}),
    {
      key: 'id',
      header: 'Return',
      width: 'shrink',
      cell: r => (
        <span className="cell-title sales-nowrap">
          <Link to="/returns/$id" params={{id: r.id}}>
            #{r.id}
          </Link>
        </span>
      ),
    },
    {key: 'createdAt', header: 'Requested', width: 'shrink', hideOnMobile: true, cell: r => <span className="muted sales-nowrap">{formatDateTime(r.createdAt)}</span>},
    {
      key: 'order',
      header: 'Order',
      cell: r => (
        <span className="sales-customer">
          <Link to="/orders/$number" params={{number: r.orderNumber}} className="sales-link">
            {r.orderNumber}
          </Link>
          <span className="cell-sub">{r.email}</span>
        </span>
      ),
    },
    {key: 'status', header: 'Status', width: 'shrink', cell: r => <Status status={r.status} />},
    {key: 'items', header: 'Items', align: 'end', width: 'shrink', cell: r => r.itemCount},
    {key: 'amount', header: 'Amount', align: 'end', width: 'shrink', cell: r => money(r.amount)},
    {key: 'actions', header: 'Actions', actions: true, cell: r => <ReturnRowMenu ret={r} busy={busy !== null} onBusy={setBusy} />},
  ];

  const emptyText = search.q
    ? 'No returns match this search.'
    : (view && EMPTY_COPY[view.key]) || (search.status ? 'No returns with this status.' : 'No return requests yet.');

  return (
    <div className="sales-screen">
      <PageHeader
        title="Returns"
        description={list.data ? `${pageCount(rows, list.hasNextPage)} ${rows.length === 1 && !list.hasNextPage ? 'return' : 'returns'}` : ' '}
      />

      <Tabs
        label="Return views"
        value={view?.key ?? 'custom'}
        onChange={key => set({status: VIEWS.find(v => v.key === key)!.status})}
        items={VIEWS.map(v => ({value: v.key, label: v.label, ...(v.key === 'requested' && pendingCount ? {count: pendingCount} : {})}))}>
        <div className="toolbar sales-toolbar">
          <div className="toolbar-group">
            <form role="search" noValidate onSubmit={submitSearch} className="sales-search">
              <SearchInput
                label="Search returns"
                placeholder="Search return, order number or email"
                value={q}
                maxLength={200}
                onChange={e => setQ(e.target.value)}
              />
            </form>
            {search.q && (
              <Button variant="ghost" size="sm" icon="x" onClick={() => set({q: undefined})}>
                Clear search
              </Button>
            )}
            {list.isFetching && !list.isPending && !list.isFetchingNextPage && (
              <span className="muted sales-updating" role="status">
                Updating…
              </span>
            )}
          </div>
        </div>

        {list.isError && !rows.length ? (
          <LoadFailed error={list.error} title="Returns could not be loaded" onRetry={() => void list.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Returns"
              columns={columns}
              rows={list.data ? rows : undefined}
              rowKey={r => r.id}
              loading={list.isPending}
              busyKey={busy}
              empty={
                <EmptyState
                  icon="rotate-ccw"
                  title={emptyText}
                  action={
                    search.q ? (
                      <Button variant="secondary" onClick={() => set({q: undefined})}>
                        Clear search
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
            <LoadMore query={list} />
          </>
        )}
      </Tabs>

      {selectedRows.length > 0 && <div aria-hidden="true" className="sales-bulk-space" />}
      <ReturnsBulkBar rows={selectedRows} onClear={clear} onDone={done => setSelected(new Set([...selected].filter(id => !done.includes(id))))} />
    </div>
  );
}
