import {useInfiniteQuery} from '@tanstack/react-query';
import {getRouteApi, Link, useNavigate} from '@tanstack/react-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {money} from '../../../lib/format';
import type {AdminCustomerRow} from '../../../lib/types/admin/customers';
import {
  CUSTOMER_ROLE_LABEL,
  CUSTOMER_ROLES,
  type CustomerRole,
  customersQuery,
  type CustomersSearch,
  DEFAULT_CUSTOMER_SORT,
} from '../../queries';
import {pageCount, useMe} from '../../shared';
import {
  Badge,
  BulkAction,
  BulkBar,
  Button,
  Card,
  Checkbox,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  Icon,
  LoadMore,
  Menu,
  PageHeader,
  Popover,
  SearchInput,
  Select,
  StatusBadge,
  useToast,
} from '../../ui';
import {copyText, csvText, errorText, formatDate, plural, saveCsv} from './lib';
import {RoleDialog} from './RoleDialog';
import {ROLE_TONES} from './tones';

const route = getRouteApi('/customers');

const SORT_OPTIONS: {value: string; label: string}[] = [
  {value: '-createdAt', label: 'Newest first'},
  {value: 'createdAt', label: 'Oldest first'},
  {value: 'email', label: 'Email A–Z'},
  {value: '-email', label: 'Email Z–A'},
  {value: 'name', label: 'Name A–Z'},
  {value: '-name', label: 'Name Z–A'},
];

const EMPTY = new Set<string>();

/** `/dashboard/customers` (port of VAREL `pages/admin/customers/CustomersList.tsx`): every account, any role. */
export function CustomersList() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const toast = useToast();
  const me = useMe();
  const canChangeRoles = Boolean(me.data?.abilities.updateUsers);
  const customers = useInfiniteQuery(customersQuery(search));
  const rows = useMemo(() => customers.data?.pages.flatMap(page => page.items), [customers.data]);
  const [roleFor, setRoleFor] = useState<AdminCustomerRow | null>(null);

  const set = (patch: Partial<CustomersSearch>) =>
    void navigate({search: prev => ({...prev, ...patch}), replace: true, resetScroll: false});
  const filtered = Boolean(search.q || search.role);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Selection belongs to the list as shown: a search or filter change starts fresh.
  const listKey = JSON.stringify(search);
  const [sel, setSel] = useState<{key: string; ids: Set<string>}>({key: listKey, ids: EMPTY});
  const selected = sel.key === listKey ? sel.ids : EMPTY;
  const setSelected = useCallback((ids: Set<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSelected(new Set()), [setSelected]);
  const selectedRows = (rows ?? []).filter(c => selected.has(c.id));
  const allSelected = Boolean(rows?.length) && rows!.every(c => selected.has(c.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const copy = (emails: string[], message: string) =>
    copyText(emails.join(', ')).then(
      () => toast.success(message),
      error => toast.danger(errorText(error))
    );

  const exportSelected = () => {
    const text = csvText(
      ['Name', 'Email', 'Role', 'Joined', 'Orders', 'Spent', 'Last order', 'Newsletter'],
      selectedRows.map(c => [c.name, c.email, c.role, c.createdAt, c.orders, c.spent.toFixed(2), c.lastOrderAt ?? '', c.newsletter ? 'yes' : 'no'])
    );
    saveCsv(text, `varel-customers-selected-${selectedRows.length}.csv`);
    toast.success(`Exported ${plural(selectedRows.length, 'customer')}`);
  };

  const columns: Column<AdminCustomerRow>[] = [
    {
      key: 'select',
      width: 'shrink',
      header: (
        <Checkbox
          label={<span className="visually-hidden">Select all loaded customers</span>}
          checked={allSelected}
          disabled={!rows?.length}
          onChange={on => setSelected(on ? new Set(rows?.map(c => c.id)) : new Set())}
        />
      ),
      cell: c => (
        <Checkbox label={<span className="visually-hidden">Select {c.name}</span>} checked={selected.has(c.id)} onChange={on => toggle(c.id, on)} />
      ),
    },
    {
      key: 'name',
      header: 'Name',
      cell: c => (
        <Link to="/customers/$id" params={{id: c.id}} className="customers-name">
          {c.name}
        </Link>
      ),
    },
    {key: 'email', header: 'Email', cell: c => <span className="muted customers-email">{c.email}</span>},
    {key: 'role', header: 'Role', width: 'shrink', cell: c => <StatusBadge tone={ROLE_TONES[c.role]}>{CUSTOMER_ROLE_LABEL[c.role]}</StatusBadge>},
    {key: 'orders', header: 'Orders', align: 'end', width: 'shrink', cell: c => c.orders},
    {key: 'spent', header: 'Spent', align: 'end', width: 'shrink', cell: c => money(c.spent)},
    {key: 'lastOrderAt', header: 'Last order', width: 'shrink', hideOnMobile: true, cell: c => <span className="muted nowrap">{formatDate(c.lastOrderAt)}</span>},
    {key: 'createdAt', header: 'Joined', width: 'shrink', hideOnMobile: true, cell: c => <span className="muted nowrap">{formatDate(c.createdAt)}</span>},
    {
      key: 'newsletter',
      header: 'Newsletter',
      width: 'shrink',
      cell: c =>
        c.newsletter ? (
          <span role="img" aria-label="Subscribed" className="customers-check">
            <Icon name="check" size={16} />
          </span>
        ) : (
          <span className="muted" aria-label="Not subscribed">
            —
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: c => <CustomerRowMenu customer={c} canChangeRoles={canChangeRoles} onCopy={() => void copy([c.email], 'Email copied')} onRole={() => setRoleFor(c)} />,
    },
  ];

  const hasNext = Boolean(customers.hasNextPage);

  return (
    <div className="app-page screen-customers">
      <PageHeader title="Customers" description={rows ? `${pageCount(rows, hasNext)} ${rows.length === 1 && !hasNext ? 'account' : 'accounts'}` : ' '} />

      <div className="toolbar">
        <div className="toolbar-group">
          <form role="search" className="customers-search" noValidate onSubmit={event => event.preventDefault()}>
            <SearchInput
              label="Search customers"
              placeholder="Search name, email or phone"
              value={q}
              maxLength={200}
              autoComplete="off"
              onChange={event => setQ(event.target.value)}
            />
          </form>
          <RoleFilter value={search.role} onChange={role => set({role})} />
          <span className="customers-sort">
            <label className="visually-hidden" htmlFor="customers-sort">
              Sort
            </label>
            <Select
              id="customers-sort"
              options={SORT_OPTIONS}
              value={search.sort ?? DEFAULT_CUSTOMER_SORT}
              onChange={event => {
                const sort = event.target.value as CustomersSearch['sort'];
                set({sort: sort === DEFAULT_CUSTOMER_SORT ? undefined : sort});
              }}
            />
          </span>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              icon="x"
              onClick={() => {
                lastQ.current = '';
                setQ('');
                void navigate({search: {sort: search.sort}, replace: true});
              }}>
              Clear filters
            </Button>
          )}
          {customers.isFetching && !customers.isPending && !customers.isFetchingNextPage && <span className="muted customers-updating">Updating…</span>}
        </div>
      </div>

      {customers.isError && !rows?.length ? (
        <Card>
          <ErrorNote error={customers.error} title="Customers could not be loaded" />
          <div className="customers-retry">
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => void customers.refetch()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <Card flush>
          <DataTable
            caption="Customers"
            columns={columns}
            rows={rows}
            rowKey={c => c.id}
            loading={customers.isPending}
            empty={
              filtered ? (
                <EmptyState
                  icon="search"
                  title="No customers match these filters."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        lastQ.current = '';
                        setQ('');
                        void navigate({search: {sort: search.sort}, replace: true});
                      }}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon="users" title="No customers yet." />
              )
            }
          />
          <LoadMore query={customers} />
        </Card>
      )}

      {selectedRows.length > 0 && <div aria-hidden="true" className="customers-bulk-spacer" />}
      <BulkBar count={selectedRows.length} noun={['customer', 'customers']} onClear={clear}>
        <BulkAction icon="copy" onClick={() => void copy(selectedRows.map(c => c.email), `${plural(selectedRows.length, 'email')} copied`)}>
          Copy emails
        </BulkAction>
        <BulkAction icon="download" onClick={exportSelected}>
          Export
        </BulkAction>
      </BulkBar>

      {roleFor && <RoleDialog customer={roleFor} open onClose={() => setRoleFor(null)} />}
    </div>
  );
}

/** A row's actions (VAREL `CustomerRowMenu`). */
function CustomerRowMenu({
  customer,
  canChangeRoles,
  onCopy,
  onRole,
}: {
  customer: AdminCustomerRow;
  canChangeRoles: boolean;
  onCopy: () => void;
  onRole: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Menu
      label={`Actions for ${customer.name}`}
      items={[
        {label: 'View customer', icon: 'eye', onSelect: () => void navigate({to: '/customers/$id', params: {id: customer.id}})},
        {
          label: customer.orders ? `View ${plural(customer.orders, 'order')}` : 'No orders yet',
          icon: 'shopping-bag',
          disabled: !customer.orders,
          onSelect: () => void navigate({to: '/orders', search: {q: customer.email}}),
        },
        {label: 'Email customer', icon: 'mail', onSelect: () => window.location.assign(`mailto:${customer.email}`)},
        {label: 'Copy email', icon: 'copy', onSelect: onCopy},
        ...(canChangeRoles ? (['separator', {label: 'Change role…', icon: 'users', onSelect: onRole}] as const) : []),
      ]}
    />
  );
}

/** The Role filter (VAREL `FilterMenu`): three checkboxes in a popover. */
function RoleFilter({value, onChange}: {value: CustomerRole[] | undefined; onChange: (roles: CustomerRole[] | undefined) => void}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const chosen = value ?? [];
  const toggle = (role: CustomerRole, on: boolean) => {
    const next = on ? [...chosen, role] : chosen.filter(r => r !== role);
    onChange(next.length ? CUSTOMER_ROLES.filter(r => next.includes(r)) : undefined);
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button button-secondary button-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        Role
        {chosen.length > 0 && <Badge tone="brand">{chosen.length}</Badge>}
        <Icon name="chevron-down" size={16} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label="Filter by role" className="customers-filter">
        <fieldset className="customers-filter-options">
          <legend className="visually-hidden">Role</legend>
          {CUSTOMER_ROLES.map(role => (
            <Checkbox key={role} label={CUSTOMER_ROLE_LABEL[role]} checked={chosen.includes(role)} onChange={on => toggle(role, on)} />
          ))}
        </fieldset>
        {chosen.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
            Clear
          </Button>
        )}
      </Popover>
    </>
  );
}
