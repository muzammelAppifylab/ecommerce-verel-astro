import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {type FormEvent, useCallback, useEffect, useMemo, useState} from 'react';

import {siteFetch} from '../../../platform/browser';
import type {AdminOrderRow, FulfillmentStatus, PaymentStatus} from '../../../lib/types/admin/sales';
import {toQueryString} from '../../api';
import {navCountsQuery} from '../../queries/overview';
import {
  FULFILLMENT_STATUSES,
  ORDER_SORTS,
  type OrdersSearch,
  ordersFiltered,
  ordersListQuery,
  ordersQuery,
  PAYMENT_STATUSES,
} from '../../queries/orders';
import {pageCount} from '../../shared';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  DateRangeFilter,
  EmptyState,
  LoadMore,
  PageHeader,
  SearchInput,
  Select,
  Tabs,
  useToast,
} from '../../ui';
import {OrderRowMenu, OrdersBulkBar} from './OrderActions';
import {FilterMenu, formatDateTime, LoadFailed, money, saveBlob, selectColumn, Status} from './ui';

/** Saved views over the existing filters. Active only when the filters match exactly. */
const VIEWS: {key: string; label: string; payment?: PaymentStatus[]; fulfillment?: FulfillmentStatus[]}[] = [
  {key: 'all', label: 'All'},
  {key: 'open', label: 'Open', fulfillment: ['Unfulfilled', 'Processing']},
  {key: 'shipped', label: 'Shipped', fulfillment: ['Shipped']},
  {key: 'delivered', label: 'Delivered', fulfillment: ['Delivered']},
  {key: 'refunded', label: 'Refunded', payment: ['Refunded']},
];
const same = (a?: string[], b?: string[]) => (a ?? []).join() === (b ?? []).join();
const EMPTY = new Set<string>();

const SORT_OPTIONS: {value: (typeof ORDER_SORTS)[number]; label: string}[] = [
  {value: '-placedAt', label: 'Newest first'},
  {value: 'placedAt', label: 'Oldest first'},
  {value: '-total', label: 'Highest total'},
  {value: 'total', label: 'Lowest total'},
];

/** `/dashboard/orders` (VAREL src/pages/admin/orders/OrdersList.tsx). */
export function OrdersList() {
  const search = useSearch({from: '/orders'});
  const navigate = useNavigate({from: '/orders'});
  const toast = useToast();
  const list = useInfiniteQuery(ordersListQuery(search));
  const openCount = useQuery(navCountsQuery).data?.openOrders;
  const rows = useMemo(() => list.data?.pages.flatMap(p => p.items) ?? [], [list.data]);

  const set = (patch: Partial<OrdersSearch>) =>
    void navigate({search: prev => ({...prev, ...patch}), replace: true, resetScroll: false});

  const filtered = ordersFiltered(search);
  const view = VIEWS.find(v => same(v.payment, search.payment) && same(v.fulfillment, search.fulfillment));

  // The search box applies on submit; it follows the URL when the URL changes (a view, "Clear filters").
  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => setQ(search.q ?? ''), [search.q]);
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    set({q: q.trim() || undefined});
  };

  // Selection belongs to the list as currently shown: any filter or sort change starts fresh.
  const listKey = JSON.stringify(search);
  const [sel, setSel] = useState<{key: string; ids: Set<string>}>({key: listKey, ids: EMPTY});
  const selected = sel.key === listKey ? sel.ids : EMPTY;
  const setSelected = useCallback((ids: Set<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSelected(new Set()), [setSelected]);
  const selectedRows = rows.filter(o => selected.has(o.number));
  const [busy, setBusy] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      // siteFetch, not a plain link: the Preview carries the session only through it, and it refreshes an expired token.
      const res = await siteFetch(`/site-api/manage/orders/export.csv${toQueryString(ordersQuery(search))}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {message?: string} | null;
        throw new Error(body?.message ?? `The export failed (${res.status})`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'varel-orders.csv';
      saveBlob(await res.blob(), name);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'The export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<AdminOrderRow>[] = [
    selectColumn({rows, keyOf: o => o.number, labelOf: o => `order ${o.number}`, selected, onChange: setSelected}),
    {
      key: 'number',
      header: 'Order',
      width: 'shrink',
      cell: o => (
        <span className="cell-title sales-nowrap">
          <Link to="/orders/$number" params={{number: o.number}}>
            {o.number}
          </Link>
        </span>
      ),
    },
    {key: 'placedAt', header: 'Placed', width: 'shrink', hideOnMobile: true, cell: o => <span className="muted sales-nowrap">{formatDateTime(o.placedAt)}</span>},
    {
      key: 'customer',
      header: 'Customer',
      cell: o => (
        <span className="sales-customer">
          <span className="sales-customer-name">
            {o.customerName}
            {!o.customerId && <Badge>Guest</Badge>}
          </span>
          <span className="cell-sub">{o.email}</span>
        </span>
      ),
    },
    {key: 'payment', header: 'Payment', width: 'shrink', cell: o => <Status status={o.payment} />},
    {key: 'fulfillment', header: 'Fulfilment', width: 'shrink', cell: o => <Status status={o.fulfillment} />},
    {key: 'items', header: 'Items', align: 'end', width: 'shrink', cell: o => o.count},
    {key: 'total', header: 'Total', align: 'end', width: 'shrink', cell: o => money(o.total, o.currency)},
    {key: 'actions', header: 'Actions', actions: true, cell: o => <OrderRowMenu order={o} busy={busy !== null} onBusy={setBusy} />},
  ];

  const clearFilters = () => void navigate({search: {sort: search.sort}, replace: true});

  return (
    <div className="sales-screen">
      <PageHeader
        title="Orders"
        description={list.data ? `${pageCount(rows, list.hasNextPage)} ${rows.length === 1 && !list.hasNextPage ? 'order' : 'orders'}` : ' '}
        actions={
          <Button
            variant="secondary"
            icon="download"
            pending={exporting}
            pendingLabel="Exporting…"
            title="Exports up to 4,000 orders with the current filters"
            onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        }
      />

      <Tabs
        label="Order views"
        value={view?.key ?? 'custom'}
        onChange={key => {
          const v = VIEWS.find(x => x.key === key)!;
          set({payment: v.payment, fulfillment: v.fulfillment});
        }}
        items={VIEWS.map(v => ({value: v.key, label: v.label, ...(v.key === 'open' && openCount ? {count: openCount} : {})}))}>
        <div className="toolbar sales-toolbar">
          <div className="toolbar-group">
            <form role="search" noValidate onSubmit={submitSearch} className="sales-search">
              <SearchInput
                label="Search orders"
                placeholder="Search number, email or name"
                value={q}
                maxLength={200}
                onChange={e => setQ(e.target.value)}
              />
            </form>
            <FilterMenu label="Payment" options={PAYMENT_STATUSES} value={search.payment} onChange={payment => set({payment})} />
            <FilterMenu label="Fulfilment" options={FULFILLMENT_STATUSES} value={search.fulfillment} onChange={fulfillment => set({fulfillment})} />
            <DateRangeFilter label="Placed" from={search.from} to={search.to} onChange={r => set({from: r.from, to: r.to})} />
            {filtered && (
              <Button variant="ghost" size="sm" icon="x" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            {list.isFetching && !list.isPending && !list.isFetchingNextPage && (
              <span className="muted sales-updating" role="status">
                Updating…
              </span>
            )}
          </div>
          <div className="toolbar-group">
            <label className="visually-hidden" htmlFor="orders-sort">
              Sort
            </label>
            <Select
              id="orders-sort"
              value={search.sort ?? '-placedAt'}
              options={SORT_OPTIONS}
              onChange={e => {
                const sort = e.target.value as (typeof ORDER_SORTS)[number];
                set({sort: sort === '-placedAt' ? undefined : sort});
              }}
            />
          </div>
        </div>

        {list.isError && !rows.length ? (
          <LoadFailed error={list.error} title="Orders could not be loaded" onRetry={() => void list.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Orders"
              columns={columns}
              rows={list.data ? rows : undefined}
              rowKey={o => o.number}
              loading={list.isPending}
              busyKey={busy}
              empty={
                filtered ? (
                  <EmptyState
                    icon="shopping-bag"
                    title="No orders match these filters."
                    action={
                      <Button variant="secondary" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState icon="shopping-bag" title="No orders yet." />
                )
              }
            />
            <LoadMore query={list} />
          </>
        )}
      </Tabs>

      {/* Room for the floating bulk bar so it never covers "Load more" */}
      {selectedRows.length > 0 && <div aria-hidden="true" className="sales-bulk-space" />}
      <OrdersBulkBar rows={selectedRows} onClear={clear} onDone={failed => setSelected(new Set(failed))} />
    </div>
  );
}
