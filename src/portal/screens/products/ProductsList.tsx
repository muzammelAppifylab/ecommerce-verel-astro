/* `/dashboard/products`: the catalog list (VAREL `ProductsList.tsx`). Search, department / category, status and
   stock filters and the sort live in the URL; keyset pages with "Load more" (no total: "25+ products").
   Rows can be selected for bulk status moves, export and delete. Readers without `manageProducts`
   (discount staff) see it read-only. */
import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {type FormEvent, useEffect, useMemo, useState} from 'react';

import {money} from '../../../lib/format';
import type {AdminProductRow, StockState} from '../../../lib/types/admin/catalog';
import {hasAbility} from '../../api';
import {departmentsQuery} from '../../queries/catalog';
import {
  DEFAULT_PRODUCT_SORT,
  PRODUCT_SORTS,
  productListParams,
  productListQuery,
  type ProductsSearch,
} from '../../queries/products';
import {pageCount, useMe, when} from '../../shared';
import {
  Button,
  buttonClass,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  Icon,
  LoadMore,
  PageHeader,
  SearchInput,
  Select,
  StatusBadge,
} from '../../ui';
import {ProductRowMenu, ProductsBulkBar, ProductStatusBadge} from './ProductActions';
import {FilterToggles, RowCheck, Thumb, useListSelection} from './list-ui';

const STATUS_OPTIONS = [
  {value: 'published', label: 'Published'},
  {value: 'draft', label: 'Draft'},
  {value: 'archived', label: 'Archived'},
] as const;

const STOCK_OPTIONS = [
  {value: 'in', label: 'In stock'},
  {value: 'low', label: 'Low'},
  {value: 'out', label: 'Out'},
  {value: 'digital', label: 'Digital'},
] as const;

export const STOCK_TONES = {in: 'success', low: 'warning', out: 'danger', digital: 'neutral'} as const;
export const STOCK_LABEL: Record<StockState, string> = {in: 'In stock', low: 'Low', out: 'Out', digital: 'Digital'};

const SORT_LABEL: Record<(typeof PRODUCT_SORTS)[number], string> = {
  '-updatedAt': 'Recently updated',
  updatedAt: 'Oldest updated',
  name: 'Name A–Z',
  '-name': 'Name Z–A',
  price: 'Price low to high',
  '-price': 'Price high to low',
  inventory: 'Inventory low to high',
  '-inventory': 'Inventory high to low',
};
const SORT_ORDER = ['-updatedAt', 'updatedAt', 'name', '-name', 'price', '-price', 'inventory', '-inventory'] as const;

export function ProductsList() {
  const search = useSearch({from: '/products'});
  const navigate = useNavigate({from: '/products'});
  const me = useMe();
  const canManage = hasAbility(me.data?.abilities, 'manageProducts');
  const sort = search.sort ?? DEFAULT_PRODUCT_SORT;

  const set = (patch: Partial<ProductsSearch>) => void navigate({search: prev => ({...prev, ...patch}), replace: true});

  const params = useMemo(() => productListParams(search), [search]);
  const products = useInfiniteQuery(productListQuery(params));
  const departments = useQuery(departmentsQuery);
  const dept = departments.data?.find(d => d.name === search.dept);
  const filtered = Boolean(search.q || search.status || search.dept || search.category || search.stock);
  const rows = products.data?.pages.flatMap(p => p.items);
  const more = Boolean(products.hasNextPage);

  const {selected, setSelected, clear, drop} = useListSelection(JSON.stringify({...params, sort}));
  const selectedRows = (rows ?? []).filter(p => selected.has(p.id));
  const [busyId, setBusyId] = useState<string | null>(null);

  // The search box applies on submit (Enter) and when cleared; it follows the URL when that changes.
  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => setQ(search.q ?? ''), [search.q]);
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    set({q: q.trim() || undefined});
  };

  const allShown = Boolean(rows?.length) && rows!.every(p => selected.has(p.id));
  const someShown = Boolean(rows?.some(p => selected.has(p.id)));
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows?.map(p => p.id)) : new Set());
  const toggleOne = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const columns: Column<AdminProductRow>[] = [
    ...(canManage
      ? [
          {
            key: 'select',
            header: <RowCheck label="Select all products shown" checked={allShown} mixed={someShown} onChange={toggleAll} disabled={!rows?.length} />,
            width: 'shrink' as const,
            cell: (p: AdminProductRow) => <RowCheck label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={on => toggleOne(p.id, on)} />,
          },
        ]
      : []),
    {
      key: 'name',
      header: 'Product',
      cell: p => (
        <span className="product-cell">
          <Thumb src={p.image?.src} />
          <span className="product-cell-text">
            <span className="cell-title">
              <Link to="/products/$id" params={{id: p.id}}>
                {p.name}
              </Link>
            </span>
            <span className="cell-sub mono">{p.sku}</span>
          </span>
        </span>
      ),
    },
    {key: 'status', header: 'Status', width: 'shrink', cell: p => <ProductStatusBadge status={p.status} />},
    {
      key: 'org',
      header: 'Department',
      hideOnMobile: true,
      cell: p => (
        <span className="muted">
          {p.dept} / {p.category}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'end',
      cell: p => (
        <span className="nowrap">
          {money(p.price)}
          {p.compareAt ? (
            <>
              {' '}
              <s className="muted">{money(p.compareAt)}</s>
            </>
          ) : null}
        </span>
      ),
    },
    {
      key: 'inventory',
      header: 'Inventory',
      align: 'end',
      cell: p => (
        <span className="inventory-cell">
          {p.inventory !== null && <span>{p.inventory}</span>}
          <StatusBadge tone={STOCK_TONES[p.stock]}>{STOCK_LABEL[p.stock]}</StatusBadge>
        </span>
      ),
    },
    {key: 'variants', header: 'Variants', align: 'end', hideOnMobile: true, cell: p => p.variantCount},
    {key: 'updatedAt', header: 'Updated', align: 'end', hideOnMobile: true, cell: p => <span className="muted nowrap">{when(p.updatedAt)}</span>},
    ...(canManage
      ? [{key: 'actions', header: '', actions: true, cell: (p: AdminProductRow) => <ProductRowMenu product={p} onBusy={setBusyId} />}]
      : []),
  ];

  const newProduct = (label: string, variant: 'primary' | 'secondary' = 'primary') =>
    canManage ? (
      <Link to="/products/new" className={buttonClass({size: 'sm', variant})}>
        <Icon name="plus" size={16} />
        {label}
      </Link>
    ) : null;

  const count = pageCount(rows, more);
  return (
    <div className={`app-page screen-products${selectedRows.length ? ' has-bulk-bar' : ''}`}>
      <PageHeader
        title="Products"
        description={rows ? (rows.length === 1 && !more ? '1 product' : `${count} products`) : 'Catalog, pricing and status'}
        actions={newProduct('New product')}
      />

      <div className="products-toolbar">
        <form role="search" className="products-search" onSubmit={submitSearch}>
          <SearchInput
            label="Search products"
            placeholder="Search name or SKU"
            value={q}
            onChange={e => {
              setQ(e.target.value);
              if (!e.target.value && search.q) set({q: undefined});
            }}
          />
        </form>
        <div className="toolbar toolbar-group products-selects">
          <Select
            aria-label="Department"
            value={search.dept ?? ''}
            options={[{value: '', label: 'All departments'}, ...(departments.data ?? []).map(d => ({value: d.name, label: d.name}))]}
            onChange={e => set({dept: e.target.value || undefined, category: undefined})}
          />
          <Select
            aria-label="Category"
            value={search.category ?? ''}
            disabled={!dept}
            options={[{value: '', label: 'All categories'}, ...(dept?.categories ?? []).map(c => ({value: c.name, label: c.name}))]}
            onChange={e => set({category: e.target.value || undefined})}
          />
          <Select
            aria-label="Sort"
            value={sort}
            options={SORT_ORDER.map(s => ({value: s, label: SORT_LABEL[s]}))}
            onChange={e => {
              const next = e.target.value as (typeof PRODUCT_SORTS)[number];
              set({sort: next === DEFAULT_PRODUCT_SORT ? undefined : next});
            }}
          />
        </div>
        <div className="products-filters">
          <FilterToggles label="Status" options={STATUS_OPTIONS} value={search.status} onChange={status => set({status})} />
          <FilterToggles label="Stock" options={STOCK_OPTIONS} value={search.stock} onChange={stock => set({stock})} />
          {filtered && (
            <Button
              variant="link"
              size="sm"
              icon="x"
              onClick={() => {
                setQ('');
                void navigate({search: prev => ({sort: prev.sort}), replace: true});
              }}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {products.isError && !rows ? (
        <div className="error-block">
          <ErrorNote title="Products could not be loaded" error={products.error} />
          <Button variant="secondary" size="sm" onClick={() => void products.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className={products.isFetching && !products.isFetchingNextPage && rows ? 'is-refreshing' : undefined}>
          <DataTable
            caption="Products"
            columns={columns}
            rows={rows}
            rowKey={p => p.id}
            loading={products.isPending}
            busyKey={busyId}
            empty={
              filtered ? (
                <EmptyState
                  icon="search"
                  title="No products match these filters."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void navigate({search: prev => ({sort: prev.sort}), replace: true})}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon="package" title="No products yet." action={newProduct('Add the first product', 'secondary')} />
              )
            }
          />
          <LoadMore query={{hasNextPage: more, isFetchingNextPage: products.isFetchingNextPage, fetchNextPage: products.fetchNextPage}} />
        </div>
      )}

      {canManage && <ProductsBulkBar rows={selectedRows} onClear={clear} onDone={drop} />}
    </div>
  );
}

