import {useInfiniteQuery} from '@tanstack/react-query';
import {Link, useBlocker, useNavigate, useSearch} from '@tanstack/react-router';
import {type FormEvent, useCallback, useEffect, useRef, useState} from 'react';

import {pluralize} from '../../../lib/format';
import type {InventoryRow} from '../../../lib/types/admin/catalog';
import {INVENTORY_STATES, type InventorySearch, inventoryQuery, useBulkInventory, useUpdateInventory} from '../../queries/inventory';
import {pageCount, useMe} from '../../shared';
import {
  Button,
  buttonClass,
  Card,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  IconButton,
  LoadMore,
  Notice,
  PageHeader,
  SearchInput,
  StatusBadge,
  type Tone,
  useConfirm,
  useToast,
} from '../../ui';
import {InventoryBulkBar, InventoryRowMenu, variantName} from './actions';
import {FilterToggles, RowCheck, Thumb, useListSelection} from './parts';

/**
 * `/dashboard/inventory` (port of VAREL `src/pages/admin/inventory/Inventory.tsx`): stock per
 * variant of physical products, edited inline (± buttons, type a count), in a bulk "Edit counts"
 * mode saved together, or for selected rows from the bulk bar. Keyset pages with "Load more"
 * instead of VAREL's numbered pages.
 */

const STATE_OPTIONS = [
  {value: 'in', label: 'In stock'},
  {value: 'low', label: 'Low'},
  {value: 'out', label: 'Out'},
] as const satisfies readonly {value: (typeof INVENTORY_STATES)[number]; label: string}[];

const STATE_LABEL: Record<InventoryRow['state'], string> = {in: 'In stock', low: 'Low', out: 'Out'};
const STATE_TONES: Record<InventoryRow['state'], Tone> = {in: 'success', low: 'warning', out: 'danger'};

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function Inventory() {
  const search = useSearch({from: '/inventory'});
  const navigate = useNavigate();
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const canAdd = !!me.data?.abilities.manageProducts;

  const set = useCallback(
    (patch: Partial<InventorySearch>) => void navigate({to: '/inventory', search: prev => ({...prev, ...patch}), replace: true}),
    [navigate]
  );

  const inventory = useInfiniteQuery(inventoryQuery(search));
  const rows = inventory.data?.pages.flatMap(p => p.items);
  const update = useUpdateInventory();
  const bulk = useBulkInventory();

  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => setQ(search.q ?? ''), [search.q]);

  const [bulkMode, setBulkMode] = useState(false);
  const [pending, setPending] = useState<Map<string, number>>(new Map());
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const {selected, setSelected, clear, drop} = useListSelection(JSON.stringify({q: search.q ?? '', state: search.state ?? []}));
  const selectedRows = bulkMode ? [] : (rows ?? []).filter(r => selected.has(r.variantId));

  useBlocker({
    shouldBlockFn: async () =>
      pendingRef.current.size > 0 &&
      !(await confirm({
        title: 'Leave without saving?',
        body: 'Your bulk stock changes have not been saved.',
        confirmLabel: 'Discard changes',
        tone: 'danger',
      })),
    enableBeforeUnload: () => pendingRef.current.size > 0,
  });

  const change = useCallback(
    (row: InventoryRow, body: {inventory: number} | {adjust: number}) =>
      update.mutate({variantId: row.variantId, ...body}, {onError: e => toast.danger(message(e, `${row.variantId} could not be updated`))}),
    [update, toast]
  );

  function setPendingValue(row: InventoryRow, value: number | null) {
    setPending(prev => {
      const next = new Map(prev);
      if (value === null || value === row.inventory) next.delete(row.variantId);
      else next.set(row.variantId, value);
      return next;
    });
  }

  function saveBulk() {
    const updates = [...pending].map(([variantId, count]) => ({variantId, inventory: count}));
    bulk.mutate(updates, {
      onSuccess: res => {
        toast.success(`Updated ${pluralize(res.updated, 'variant')}`);
        setPending(new Map());
        setBulkMode(false);
      },
      onError: e => toast.danger(message(e, 'The changes could not be saved')),
    });
  }

  async function exitBulk() {
    if (pending.size) {
      const ok = await confirm({
        title: 'Discard unsaved stock changes?',
        body: `${pluralize(pending.size, 'change')} will be lost.`,
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!ok) return;
      setPending(new Map());
    }
    setBulkMode(false);
  }

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    set({q: q.trim() || undefined});
  };

  const loaded = rows ?? [];
  const allOn = loaded.length > 0 && loaded.every(r => selected.has(r.variantId));
  const someOn = loaded.some(r => selected.has(r.variantId));

  const columns: Column<InventoryRow>[] = [];
  if (!bulkMode)
    columns.push({
      key: 'select',
      header: (
        <RowCheck
          label={allOn ? 'Deselect all variants' : 'Select all variants'}
          checked={allOn}
          indeterminate={someOn}
          disabled={!loaded.length}
          onChange={() => setSelected(allOn ? new Set() : new Set(loaded.map(r => r.variantId)))}
        />
      ),
      width: 'shrink',
      cell: r => (
        <RowCheck
          label={`Select ${r.variantId}`}
          checked={selected.has(r.variantId)}
          onChange={on => {
            const next = new Set(selected);
            if (on) next.add(r.variantId);
            else next.delete(r.variantId);
            setSelected(next);
          }}
        />
      ),
    });
  columns.push(
    {
      key: 'product',
      header: 'Product',
      cell: r => (
        <span className="inv-product cell-title">
          <Thumb src={r.image?.src} />
          <Link to="/products/$id" params={{id: r.productId}}>
            {r.productName}
          </Link>
        </span>
      ),
    },
    {key: 'variant', header: 'Variant', cell: r => <span className="muted">{variantName(r)}</span>},
    {key: 'sku', header: 'SKU', hideOnMobile: true, cell: r => <code className="inv-sku">{r.variantId}</code>},
    {key: 'state', header: 'State', width: 'shrink', cell: r => <StatusBadge tone={STATE_TONES[r.state]}>{STATE_LABEL[r.state]}</StatusBadge>},
    {
      key: 'inventory',
      header: 'Inventory',
      align: 'end',
      width: 'shrink',
      cell: r =>
        bulkMode ? (
          <BulkCell row={r} value={pending.get(r.variantId)} onChange={v => setPendingValue(r, v)} />
        ) : (
          <StockCell row={r} onSet={n => change(r, {inventory: n})} onAdjust={d => change(r, {adjust: d})} />
        ),
    }
  );
  if (!bulkMode)
    columns.push({
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: r => <InventoryRowMenu row={r} onZero={() => change(r, {inventory: 0})} />,
    });

  const filtered = !!(search.q || search.state?.length);

  return (
    <div className="app-page screen-inventory">
      <PageHeader
        title="Inventory"
        description={rows ? `${pageCount(rows, !!inventory.hasNextPage)} variants · physical products only` : 'Stock per variant'}
        actions={
          bulkMode ? (
            <>
              <Button variant="secondary" icon="x" onClick={() => void exitBulk()} disabled={bulk.isPending}>
                Stop editing
              </Button>
              <Button icon="check" onClick={saveBulk} pending={bulk.isPending} pendingLabel="Saving…" disabled={!pending.size}>
                Save {pending.size ? pluralize(pending.size, 'change') : 'changes'}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              icon="boxes"
              onClick={() => {
                clear();
                setBulkMode(true);
              }}
              disabled={!rows?.length}>
              Edit counts
            </Button>
          )
        }
      />

      {bulkMode && (
        <Notice tone="info">
          Type new stock counts, then save them together. Changes are kept while you page or filter. To set or adjust many variants at
          once, stop editing and select rows instead.
        </Notice>
      )}

      <div className="toolbar">
        <form className="inv-search" role="search" onSubmit={onSearch} noValidate>
          <SearchInput
            label="Search product or SKU"
            placeholder="Search product or SKU"
            value={q}
            maxLength={200}
            autoComplete="off"
            onChange={e => {
              setQ(e.target.value);
              // The box's clear button: show everything again.
              if (!e.target.value && search.q) set({q: undefined});
            }}
          />
        </form>
        <FilterToggles label="Stock state" options={STATE_OPTIONS} value={search.state} onChange={state => set({state})} />
      </div>

      {inventory.isError && !rows ? (
        <div className="inv-error">
          <ErrorNote title="Inventory could not be loaded" error={inventory.error} />
          <Button variant="secondary" onClick={() => void inventory.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <Card flush>
          <DataTable
            caption="Inventory"
            columns={columns}
            rows={rows}
            rowKey={r => r.variantId}
            loading={inventory.isPending}
            busyKey={update.isPending ? update.variables?.variantId : null}
            empty={
              filtered ? (
                <EmptyState
                  icon="search"
                  title="No variants match these filters."
                  action={
                    <Button variant="secondary" onClick={() => set({q: undefined, state: undefined})}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon="package"
                  title="No physical products yet."
                  action={
                    canAdd ? (
                      <Link className={buttonClass({variant: 'secondary'})} to="/products/new">
                        Add product
                      </Link>
                    ) : undefined
                  }
                />
              )
            }
          />
          <LoadMore query={inventory} />
        </Card>
      )}

      {/* Room for the floating bulk bar so it never covers "Load more". */}
      {selectedRows.length > 0 && <div aria-hidden="true" className="inv-bar-space" />}
      <InventoryBulkBar rows={selectedRows} onClear={clear} onDone={drop} />
    </div>
  );
}

/** Inline stock editor: saves on blur or Enter, Escape reverts; ±1 buttons adjust. */
function StockCell({row, onSet, onAdjust}: {row: InventoryRow; onSet: (n: number) => void; onAdjust: (delta: number) => void}) {
  const [value, setValue] = useState(String(row.inventory));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setValue(String(row.inventory));
  }, [row.inventory]);

  const commit = () => {
    const n = Number(value);
    if (value === '' || !Number.isInteger(n) || n < 0) {
      setValue(String(row.inventory));
      return;
    }
    if (n !== row.inventory) onSet(n);
  };

  return (
    <span className="stock-cell">
      <IconButton
        icon="minus"
        size="sm"
        variant="secondary"
        label={`Decrease ${row.variantId}`}
        disabled={row.inventory <= 0}
        onClick={() => onAdjust(-1)}
      />
      <input
        className="stock-input"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`Inventory for ${row.variantId}`}
        value={value}
        onFocus={e => {
          focused.current = true;
          e.target.select();
        }}
        onChange={e => setValue(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            const el = e.currentTarget;
            setValue(String(row.inventory));
            requestAnimationFrame(() => el.blur());
          }
        }}
      />
      <IconButton icon="plus" size="sm" variant="secondary" label={`Increase ${row.variantId}`} onClick={() => onAdjust(1)} />
    </span>
  );
}

function BulkCell({row, value, onChange}: {row: InventoryRow; value: number | undefined; onChange: (v: number | null) => void}) {
  const changed = value !== undefined;
  return (
    <span className="stock-cell">
      {changed && <span className="inv-old">{row.inventory}</span>}
      <input
        className="stock-input"
        data-changed={changed ? '' : undefined}
        inputMode="numeric"
        autoComplete="off"
        aria-label={`New inventory for ${row.variantId}`}
        value={changed ? String(value) : String(row.inventory)}
        onFocus={e => e.target.select()}
        onChange={e => {
          const raw = e.target.value.replace(/[^\d]/g, '');
          onChange(raw === '' ? 0 : Number(raw));
        }}
      />
    </span>
  );
}
