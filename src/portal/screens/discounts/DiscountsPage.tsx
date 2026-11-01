import {useQuery} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback, useMemo, useState} from 'react';

import {money} from '../../../lib/format';
import type {AdminDiscount, DiscountBulkResult} from '../../../lib/types/admin/promotions';
import {
  type DiscountMethod,
  type DiscountsSearch,
  discountProblem,
  discountSearchQuery,
  discountsQuery,
  useBulkDiscounts,
  useUpdateDiscount,
} from '../../queries/discounts';
import {
  BulkAction,
  BulkBar,
  Button,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  SearchInput,
  StatusBadge,
  Switch,
  Tabs,
  useConfirm,
  useToast,
} from '../../ui';
import {CreateDiscountModal} from './CreateDiscountModal';
import {copyText, FilterToggles, useCanWrite} from './controls';
import {STATUSES, STATUS_LABEL, STATUS_TONES, codeText, localSummary, nameOfDiscount as nameOf, pluralize} from './helpers';

const EMPTY = new Set<string>();
const LIST_CAP = 100;

type MethodTab = 'all' | DiscountMethod;
const METHOD_TABS: {value: MethodTab; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'code', label: 'Codes'},
  {value: 'automatic', label: 'Automatic'},
];

type BulkKind = 'activate' | 'deactivate' | 'delete';

/** `/dashboard/discounts`: every discount, filtered client side (VAREL `DiscountsPage`). */
export function DiscountsPage() {
  const canWrite = useCanWrite();
  const search = useSearch({from: '/discounts'});
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const setSearch = (patch: Partial<DiscountsSearch>) =>
    void navigate({to: '/discounts', search: {...search, ...patch}, replace: true});

  // The full list feeds the tab counts; filters apply client side so switching is instant.
  const {data, isLoading, error, refetch} = useQuery(discountsQuery());
  const update = useUpdateDiscount();
  const bulk = useBulkDiscounts();
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState<BulkKind | null>(null);

  const all = useMemo(() => (data ? [...data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : undefined), [data]);
  const counts = useMemo(() => {
    const c = {all: all?.length ?? 0, code: 0, automatic: 0};
    for (const d of all ?? []) c[d.method === 'automatic' ? 'automatic' : 'code']++;
    return c;
  }, [all]);
  const q = search.q?.toLowerCase();
  // Unique codes aren't in the list rows: the server search also matches them.
  const matches = useQuery({...discountSearchQuery(search.q ?? ''), enabled: !!q});
  const codeHits = useMemo(() => (q ? new Set((matches.data ?? []).map(d => d.id)) : null), [q, matches.data]);
  const rows = useMemo(
    () =>
      all?.filter(
        d =>
          (!search.method || d.method === search.method) &&
          (!search.status || search.status.includes(d.status)) &&
          (!q || [d.name, d.code, d.label, localSummary(d)].some(s => s?.toLowerCase().includes(q)) || !!codeHits?.has(d.id))
      ),
    [all, search.method, search.status, q, codeHits]
  );

  // Selection belongs to one view of the list: it resets when the search changes.
  const listKey = JSON.stringify(search);
  const [sel, setSel] = useState<{key: string; ids: Set<string>}>({key: listKey, ids: EMPTY});
  const selected = sel.key === listKey ? sel.ids : EMPTY;
  const setSelected = useCallback((ids: Set<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSelected(new Set()), [setSelected]);
  const selectedRows = (rows ?? []).filter(d => selected.has(d.id));
  const allVisibleSelected = !!rows?.length && rows.every(d => selected.has(d.id));

  const open = (d: AdminDiscount, tab?: 'report') =>
    void navigate({to: '/discounts/$id', params: {id: d.id}, search: tab ? {tab} : {}});

  function toggle(d: AdminDiscount, active: boolean) {
    setBusyId(d.id);
    update.mutate(
      {id: d.id, active},
      {
        onSuccess: () => toast.success(`${nameOf(d)} ${active ? 'activated' : 'deactivated'}`),
        onError: e => toast.danger(discountProblem(e)),
        onSettled: () => setBusyId(null),
      }
    );
  }

  function report(action: BulkKind, {done, deactivated, failed}: DiscountBulkResult) {
    const verb = action === 'delete' ? 'deleted' : action === 'activate' ? 'activated' : 'deactivated';
    if (done.length) toast.success(done.length === 1 ? `${nameOf(done[0]!)} ${verb}` : `${pluralize(done.length, 'discount')} ${verb}`);
    if (deactivated.length)
      toast.info(`${deactivated.map(nameOf).join(', ')} ${deactivated.length === 1 ? 'has' : 'have'} been used, so deactivated instead`);
    if (failed.length) toast.danger(`${failed.map(f => nameOf(f.discount)).join(', ')}: ${discountProblem(failed[0]!.error)}`);
    setSelected(new Set(failed.map(f => f.discount.id)));
  }

  async function run(action: BulkKind, targets: AdminDiscount[], ask: boolean) {
    if (!targets.length) return;
    let result: DiscountBulkResult | null = null;
    const work = async () => {
      result = await bulk.mutateAsync({discounts: targets, action});
    };
    if (!ask) {
      setBulkRunning(action);
      try {
        await work();
      } catch (e) {
        toast.danger(discountProblem(e));
      } finally {
        setBulkRunning(null);
      }
    } else {
      const used = targets.filter(d => d.used > 0);
      const verb = action === 'delete' ? 'Delete' : 'Deactivate';
      const ok = await confirm({
        title: targets.length === 1 ? `${verb} ${nameOf(targets[0]!)}?` : `${verb} ${pluralize(targets.length, 'discount')}?`,
        body: (
          <>
            {action === 'deactivate'
              ? 'Customers can no longer get these discounts. You can activate them again at any time.'
              : 'Unused discounts are removed for good. Discounts already used on orders are kept for order history and deactivated instead.'}
            <ul className="confirm-list">
              {targets.map(d => (
                <li key={d.id}>
                  <span>{nameOf(d)}</span>
                  <span className="muted">
                    {action === 'delete' && d.used > 0 ? `Used ${pluralize(d.used, 'time')} · deactivates` : STATUS_LABEL[d.status]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ),
        confirmLabel: action === 'delete' ? (used.length === targets.length ? 'Deactivate' : 'Delete') : 'Deactivate',
        pendingLabel: action === 'delete' ? 'Deleting…' : 'Deactivating…',
        tone: 'danger',
        action: work,
      });
      if (!ok) return;
    }
    if (result) report(action, result);
  }

  const toActivate = selectedRows.filter(d => !d.active);
  const toDeactivate = selectedRows.filter(d => d.active);

  const rowMenu = (d: AdminDiscount): MenuItem[] => {
    const items: MenuItem[] = [
      {label: canWrite ? 'Edit' : 'View', icon: 'pencil', onSelect: () => open(d)},
      {label: 'Report', icon: 'bar-chart', onSelect: () => open(d, 'report')},
    ];
    if (d.method === 'code' && d.codeType === 'shared' && d.code) items.push({label: 'Copy code', icon: 'copy', onSelect: () => copyText(d.code!, toast)});
    if (canWrite)
      items.push(
        {label: 'Duplicate', icon: 'copy', onSelect: () => void navigate({to: '/discounts/new', search: {from: d.id}})},
        'separator',
        {label: d.active ? 'Deactivate' : 'Activate', icon: d.active ? 'ban' : 'check-circle', onSelect: () => toggle(d, !d.active)},
        'separator',
        {label: d.used > 0 ? 'Delete (deactivates)…' : 'Delete…', icon: 'trash', danger: true, onSelect: () => void run('delete', [d], true)}
      );
    return items;
  };

  const columns: Column<AdminDiscount>[] = [
    ...(canWrite
      ? [
          {
            key: 'select',
            header: (
              <input
                type="checkbox"
                className="row-check"
                aria-label="Select all shown discounts"
                checked={allVisibleSelected}
                disabled={!rows?.length}
                onChange={e => setSelected(e.target.checked ? new Set(rows?.map(d => d.id)) : new Set())}
              />
            ),
            width: 'shrink' as const,
            cell: (d: AdminDiscount) => (
              <input
                type="checkbox"
                className="row-check"
                aria-label={`Select ${nameOf(d)}`}
                checked={selected.has(d.id)}
                onChange={e => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(d.id);
                  else next.delete(d.id);
                  setSelected(next);
                }}
              />
            ),
          },
        ]
      : []),
    {
      key: 'name',
      header: 'Discount',
      cell: d => {
        const plainCode = d.method === 'code' && d.codeType === 'shared' && (!d.name || d.name === d.code);
        const monoCode = d.method === 'code' && d.codeType === 'shared' && d.name && d.name !== d.code;
        return (
          <span className="cell-title discount-name-cell">
            <Link to="/discounts/$id" params={{id: d.id}}>
              {nameOf(d)}
            </Link>
            <span className={monoCode ? 'cell-sub mono' : 'cell-sub'}>{plainCode ? 'Code' : codeText(d)}</span>
          </span>
        );
      },
    },
    {
      key: 'summary',
      header: 'Summary',
      hideOnMobile: true,
      cell: d => <span className="discount-summary-cell">{localSummary(d) || d.label}</span>,
    },
    {key: 'status', header: 'Status', width: 'shrink', cell: d => <StatusBadge tone={STATUS_TONES[d.status]}>{STATUS_LABEL[d.status]}</StatusBadge>},
    {
      key: 'uses',
      header: 'Uses',
      align: 'end',
      width: 'shrink',
      cell: d => (
        <span className="num">
          {d.used.toLocaleString('en-US')}
          <span className="muted"> / {d.usageLimit?.toLocaleString('en-US') ?? '∞'}</span>
        </span>
      ),
    },
    {key: 'given', header: 'Discount given', align: 'end', width: 'shrink', cell: d => <span className="num">{money(d.totalDiscounted ?? 0)}</span>},
    {key: 'revenue', header: 'Revenue', align: 'end', width: 'shrink', hideOnMobile: true, cell: d => <span className="num">{money(d.revenue ?? 0)}</span>},
    {
      key: 'active',
      header: 'Active',
      width: 'shrink',
      cell: d => (
        <span className="discount-switch">
          <Switch
            label={<span className="visually-hidden">{`${nameOf(d)} active`}</span>}
            checked={d.active}
            disabled={!canWrite || (busyId !== null && busyId !== d.id)}
            pending={busyId === d.id}
            onChange={v => toggle(d, v)}
          />
        </span>
      ),
    },
    {key: 'actions', header: '', actions: true, cell: d => <Menu label={`Actions for ${nameOf(d)}`} items={rowMenu(d)} />},
  ];

  const filtered = !!(search.method || search.status || search.q);

  return (
    <div className="app-page discount-screen">
      <PageHeader
        title="Discounts"
        description="Codes customers enter, and automatic offers that apply on their own."
        actions={
          canWrite && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Create discount
            </Button>
          )
        }
      />

      <Tabs<MethodTab>
        label="Discount type"
        items={METHOD_TABS.map(t => ({value: t.value, label: t.label, count: counts[t.value]}))}
        value={search.method ?? 'all'}
        onChange={v => setSearch({method: v === 'all' ? undefined : v})}>
        <div className="discount-list">
          <div className="toolbar discount-toolbar">
            <SearchInput
              label="Search discounts"
              placeholder="Search name, code or summary"
              value={search.q ?? ''}
              maxLength={60}
              onChange={e => setSearch({q: e.target.value || undefined})}
            />
            <FilterToggles
              label="Status"
              options={STATUSES.map(s => ({value: s, label: STATUS_LABEL[s]}))}
              value={search.status}
              onChange={status => setSearch({status})}
            />
          </div>

          {data && data.length >= LIST_CAP && !filtered && (
            <Notice tone="info">Showing the newest {LIST_CAP} discounts. Search to find older ones.</Notice>
          )}

          {error && !data ? (
            <div className="discount-load-error">
              <ErrorNote error={error} title="Discounts could not be loaded" />
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <DataTable
              caption="Discounts"
              columns={columns}
              rows={rows}
              rowKey={d => d.id}
              loading={isLoading}
              busyKey={busyId}
              empty={
                filtered ? (
                  <EmptyState icon="search" title="No discounts match these filters." />
                ) : (
                  <EmptyState
                    icon="percent"
                    title="No discounts yet."
                    action={
                      canWrite && (
                        <Button variant="secondary" onClick={() => setCreating(true)}>
                          Create the first discount
                        </Button>
                      )
                    }
                  />
                )
              }
            />
          )}
        </div>
      </Tabs>

      {selectedRows.length > 0 && <div aria-hidden="true" className="bulk-spacer" />}
      {selectedRows.length > 0 && (
        <BulkBar count={selectedRows.length} noun={['discount', 'discounts']} onClear={clear}>
          <BulkAction
            icon="check-circle"
            disabled={!toActivate.length || bulk.isPending}
            pending={bulkRunning === 'activate'}
            pendingLabel="Activating…"
            onClick={() => void run('activate', toActivate, false)}>
            Activate
          </BulkAction>
          <BulkAction icon="ban" disabled={!toDeactivate.length || bulk.isPending} onClick={() => void run('deactivate', toDeactivate, true)}>
            Deactivate
          </BulkAction>
          <BulkAction icon="trash" danger disabled={bulk.isPending} onClick={() => void run('delete', selectedRows, true)}>
            Delete
          </BulkAction>
        </BulkBar>
      )}

      {canWrite && <CreateDiscountModal open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}
