import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {money, pluralize} from '../../../lib/format';
import type {AbandonedBagRow, AbandonedBulkAction} from '../../../lib/types/admin/merchandising';
import {hasAbility} from '../../api';
import {meQuery} from '../../queries';
import {
  abandonedKeys,
  abandonedListQuery,
  type AbandonedFilters,
  bulkAbandoned,
  DEFAULT_ABANDONED_FILTERS,
  patchAbandonedSettings,
  runAbandoned,
  sendAbandonedReminder,
} from '../../queries/abandoned';
import {
  BulkAction,
  BulkBar,
  Button,
  Checkbox,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  IconButton,
  LoadMore,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
  useConfirm,
  useToast,
} from '../../ui';
import {BagDrawer} from './BagDrawer';
import {downloadCsv} from './csv';
import {ago, bulkText, customerOf, FILTERS, formatDateTime, remindableOf, SORT_OPTIONS, STATUS_HINT, STATUS_LABEL, STATUS_TONES} from './format';
import {ReminderSettings} from './ReminderSettings';
import {SummaryTiles} from './SummaryTiles';

/**
 * `/dashboard/abandoned`: port of VAREL src/pages/admin/abandoned/AbandonedBags.tsx. Bags with pieces
 * and an email address that never reached an order; reminders by hand, in bulk, or "due now".
 */
export function AbandonedBags() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const me = useQuery(meQuery);
  const canSettings = hasAbility(me.data?.abilities, 'manageStoreSettings');

  const [filters, setFilters] = useState<AbandonedFilters>(DEFAULT_ABANDONED_FILTERS);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<AbandonedBagRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState<AbandonedBulkAction | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const list = useInfiniteQuery(abandonedListQuery(filters));
  const first = list.data?.pages[0];
  const rows = useMemo(() => list.data?.pages.flatMap(p => p.items), [list.data]);
  const s = first?.settings;
  const sum = first?.summary;

  const clear = useCallback(() => setSelected(new Set()), []);
  const setFilter = (next: Partial<AbandonedFilters>) => {
    setFilters(f => ({...f, ...next}));
    clear();
  };

  // Search: 300 ms after the last key.
  useEffect(() => {
    const q = search.trim();
    if (q === filters.q) return;
    const t = window.setTimeout(() => setFilter({q}), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const invalidate = () => queryClient.invalidateQueries({queryKey: abandonedKeys.all});
  const failed = (e: Error) => toast.danger(e.message);

  const settings = useMutation({
    mutationFn: ({body}: {body: Parameters<typeof patchAbandonedSettings>[0]; done: string}) => patchAbandonedSettings(body),
    onSuccess: (_r, {done}) => {
      toast.success(done);
      void queryClient.invalidateQueries({queryKey: ['manage', 'settings']});
    },
    onError: failed,
    onSettled: invalidate,
  });

  const run = useMutation({
    mutationFn: runAbandoned,
    onSuccess: r => toast.success(r.sent ? `${pluralize(r.sent, 'reminder')} sent` : 'No bags are due a reminder right now'),
    onError: failed,
    onSettled: invalidate,
  });

  const remind = useMutation({
    mutationFn: (row: AbandonedBagRow) => sendAbandonedReminder(row.id),
    onMutate: row => setSendingId(row.id),
    onSuccess: (fresh, row) => {
      toast.success(`Reminder sent to ${row.email}`);
      setOpen(o => (o?.id === row.id ? fresh : o));
    },
    onError: failed,
    onSettled: () => {
      setSendingId(null);
      void invalidate();
    },
  });

  const bulk = useMutation({
    mutationFn: ({ids, action}: {ids: string[]; action: AbandonedBulkAction; after?: () => void}) => bulkAbandoned(ids, action),
    onSuccess: (r, {after}) => {
      toast.success(bulkText(r));
      clear();
      after?.();
    },
    onSettled: () => {
      setBulkPending(null);
      setDismissingId(null);
      void invalidate();
    },
  });

  const runBulk = (action: AbandonedBulkAction, ids: string[], after?: () => void) => {
    setBulkPending(action);
    bulk.mutate({ids, action, after}, {onError: failed});
  };
  const dismissOne = (r: AbandonedBagRow, after?: () => void) => {
    setDismissingId(r.id);
    runBulk(r.status === 'dismissed' ? 'restore' : 'dismiss', [r.id], after);
  };

  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(done),
      () => toast.danger('Copy failed')
    );

  const loaded = rows ?? [];
  const selectedRows = loaded.filter(r => selected.has(r.id));
  const remindable = remindableOf(selectedRows);
  const remindEmails = new Set(remindable.map(r => r.email.toLowerCase())).size;
  const allSelected = loaded.length > 0 && loaded.every(r => selected.has(r.id));
  const toggle = (id: string, on: boolean) =>
    setSelected(cur => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const confirmRemind = () =>
    void confirm({
      title: `Send ${pluralize(remindEmails, 'reminder email')}?`,
      body: [
        'Each shopper gets one email with a link that restores their bag, even if they were reminded before.',
        selectedRows.length > remindable.length
          ? ` ${pluralize(selectedRows.length - remindable.length, 'older, dismissed or ordered bag')} will be skipped.`
          : '',
        remindable.length > remindEmails ? ' Bags from the same shopper are sent as one email.' : '',
      ].join(''),
      confirmLabel: 'Send reminders',
      pendingLabel: 'Sending…',
      tone: 'primary',
      action: async () => {
        setBulkPending('remind');
        try {
          await bulk.mutateAsync({ids: remindable.map(r => r.id), action: 'remind'});
        } finally {
          setBulkPending(null);
        }
      },
    });

  const columns: Column<AbandonedBagRow>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          label={<span className="visually-hidden">Select all loaded bags</span>}
          checked={allSelected}
          disabled={!loaded.length}
          onChange={on => setSelected(on ? new Set(loaded.map(r => r.id)) : new Set())}
        />
      ),
      width: 'shrink',
      cell: r => (
        <Checkbox
          label={<span className="visually-hidden">Select bag from {r.email}</span>}
          checked={selected.has(r.id)}
          onChange={on => toggle(r.id, on)}
        />
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: r => (
        <div className="ab-customer">
          <button type="button" className="ab-email" onClick={() => setOpen(r)}>
            {r.email}
          </button>
          <span className="ab-muted">{customerOf(r)}</span>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Bag',
      hideOnMobile: true,
      cell: r => (
        <div className="ab-bag">
          <span className="ab-thumbs" aria-hidden="true">
            {r.items.slice(0, 3).map((i, n) => (
              <img key={n} className="ab-thumb" src={i.image.src} alt="" width={28} height={37} loading="lazy" />
            ))}
          </span>
          <span className="ab-bag-text">
            <span className="ab-bag-names">{r.items.map(i => i.name).join(', ')}</span>
            <span className="ab-muted">{pluralize(r.itemCount, 'piece')}</span>
          </span>
        </div>
      ),
    },
    {key: 'value', header: 'Value', align: 'end', width: 'shrink', cell: r => <span className="ab-num">{money(r.value)}</span>},
    {
      key: 'last',
      header: 'Last activity',
      width: 'shrink',
      cell: r => (
        <time className="ab-nowrap" dateTime={r.lastActivity} title={formatDateTime(r.lastActivity)}>
          {ago(r.lastActivity)}
        </time>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'shrink',
      cell: r => (
        <span className="ab-status" title={STATUS_HINT[r.status]}>
          <StatusBadge tone={STATUS_TONES[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
          <span className="visually-hidden">{STATUS_HINT[r.status]}</span>
          {r.reminderSentAt && <span className="ab-muted ab-nowrap">Sent {ago(r.reminderSentAt).toLowerCase()}</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: r => {
        const items: MenuItem[] = [
          {label: 'View bag', icon: 'eye', onSelect: () => setOpen(r)},
          {
            label: r.reminderSentAt ? 'Send another reminder' : 'Send reminder now',
            icon: 'mail',
            disabled: !!sendingId,
            onSelect: () => remind.mutate(r),
          },
          {label: 'Copy email', icon: 'copy', onSelect: () => void copy(r.email, 'Email copied')},
          ...(r.userId ? [{label: 'View customer', icon: 'users', onSelect: () => void navigate({to: '/customers/$id', params: {id: r.userId!}})} as MenuItem] : []),
          'separator',
          r.status === 'dismissed'
            ? {label: 'Restore', icon: 'rotate-ccw', disabled: !!bulkPending, onSelect: () => dismissOne(r)}
            : {label: 'Dismiss', icon: 'ban', disabled: !!bulkPending, onSelect: () => dismissOne(r)},
        ];
        return (
          <div className="row-actions">
            <IconButton
              icon="mail"
              size="sm"
              label={r.reminderSentAt ? `Send ${r.email} another reminder` : `Send ${r.email} a reminder now`}
              pending={sendingId === r.id}
              disabled={!!sendingId && sendingId !== r.id}
              onClick={() => remind.mutate(r)}
            />
            <Menu label={`More actions for ${r.email}`} items={items} />
          </div>
        );
      },
    },
  ];

  const filtered = filters.q !== '' || filters.status !== 'all';
  const busyKey = sendingId ?? dismissingId;

  return (
    <div className="app-page screen-abandoned">
      <PageHeader
        title="Abandoned bags"
        description="Bags with pieces and an email address that never reached an order. Only a shopper's newest bag gets a reminder, with a link that restores it."
        actions={
          <div className="ab-run">
            <Button variant="secondary" icon="refresh" pending={run.isPending} pendingLabel="Sending…" disabled={!s?.enabled} onClick={() => run.mutate()}>
              Send due reminders{sum?.abandoned.count ? ` (${sum.abandoned.count})` : ''}
            </Button>
            <span className="ab-muted ab-run-hint">
              {!s ? ' ' : s.enabled ? 'Send every reminder that is due now, without waiting for the next 15-minute run' : 'Turn on reminder emails first'}
            </span>
          </div>
        }
      />

      <ReminderSettings
        settings={s}
        canEdit={canSettings}
        pending={settings.isPending}
        onChange={(body, done) => settings.mutate({body, done})}
      />

      <SummaryTiles summary={sum} status={filters.status} onFilter={status => setFilter({status})} />

      {first?.capped && (
        <Notice tone="info">Showing the 500 most recently active bags. Older bags are still reminded by the scheduled job.</Notice>
      )}

      <div className="toolbar ab-toolbar">
        <SearchInput label="Search bags" placeholder="Search by email or product" value={search} onChange={e => setSearch(e.target.value)} />
        <label className="ab-sort">
          <span className="visually-hidden">Sort</span>
          <Select
            aria-label="Sort"
            value={filters.sort}
            options={SORT_OPTIONS}
            onChange={e => setFilter({sort: e.target.value as AbandonedFilters['sort']})}
          />
        </label>
      </div>

      <Tabs
        label="Filter by status"
        value={filters.status}
        onChange={status => setFilter({status})}
        items={FILTERS.map(f => {
          const n = f.value === 'all' ? undefined : sum?.[f.value].count;
          return {value: f.value, label: f.label, count: n ? n : undefined};
        })}>
        {list.isError && !rows?.length ? (
          <div className="ab-error">
            <ErrorNote error={list.error} title="Abandoned bags could not be loaded" />
            <Button variant="secondary" icon="refresh" pending={list.isFetching} pendingLabel="Trying again…" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <DataTable
              caption="Abandoned bags"
              columns={columns}
              rows={rows}
              rowKey={r => r.id}
              loading={list.isPending}
              busyKey={busyKey}
              empty={
                filtered ? (
                  <EmptyState
                    icon="shopping-cart"
                    title="No bags match these filters."
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearch('');
                          setFilter(DEFAULT_ABANDONED_FILTERS);
                        }}>
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState icon="shopping-cart" title="No abandoned bags.">
                    Bags appear here once a shopper with an email address leaves pieces behind.
                  </EmptyState>
                )
              }
            />
            <LoadMore query={list} />
          </>
        )}
      </Tabs>

      <BulkBar count={selectedRows.length} noun={['bag', 'bags']} onClear={clear}>
        <BulkAction
          icon="mail"
          pending={bulkPending === 'remind'}
          pendingLabel="Sending…"
          disabled={!remindable.length || !!bulkPending}
          hint={remindable.length ? undefined : 'Older, dismissed and ordered bags are never reminded'}
          onClick={confirmRemind}>
          Send reminders
        </BulkAction>
        {selectedRows.some(r => r.status === 'dismissed') ? (
          <BulkAction
            icon="rotate-ccw"
            pending={bulkPending === 'restore' && !dismissingId}
            pendingLabel="Restoring…"
            disabled={!!bulkPending}
            onClick={() => runBulk('restore', selectedRows.map(r => r.id))}>
            Restore
          </BulkAction>
        ) : (
          <BulkAction
            icon="ban"
            pending={bulkPending === 'dismiss' && !dismissingId}
            pendingLabel="Dismissing…"
            disabled={!!bulkPending}
            onClick={() => runBulk('dismiss', selectedRows.map(r => r.id))}>
            Dismiss
          </BulkAction>
        )}
        <BulkAction icon="copy" onClick={() => void copy([...new Set(selectedRows.map(r => r.email))].join(', '), 'Emails copied')}>
          Copy emails
        </BulkAction>
        <BulkAction
          icon="download"
          onClick={() => {
            downloadCsv(selectedRows);
            toast.success(`Exported ${pluralize(selectedRows.length, 'bag')}`);
          }}>
          Export
        </BulkAction>
      </BulkBar>

      <BagDrawer
        bag={open}
        onClose={() => setOpen(null)}
        sending={!!open && sendingId === open.id}
        busy={!!sendingId && sendingId !== open?.id}
        dismissing={!!open && dismissingId === open.id}
        onRemind={r => remind.mutate(r)}
        onDismiss={r => dismissOne(r, () => setOpen(null))}
      />
    </div>
  );
}
