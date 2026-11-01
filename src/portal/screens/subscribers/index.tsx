import {useInfiniteQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {getRouteApi} from '@tanstack/react-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {AdminSubscriber} from '../../../lib/types/admin/customers';
import {siteFetch} from '../../../platform/browser';
import {manage, toQueryString} from '../../api';
import {subscriberKeys, subscribersQuery} from '../../queries';
import {pageCount} from '../../shared';
import {
  BulkAction,
  BulkBar,
  Button,
  Card,
  Checkbox,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  LoadMore,
  Menu,
  PageHeader,
  SearchInput,
  useConfirm,
  useToast,
} from '../../ui';
import {copyText, csvText, errorText, formatDateTime, plural, saveBlob, saveCsv, settle, today} from '../customers/lib';

/**
 * `/dashboard/subscribers` (port of VAREL `pages/admin/subscribers/{SubscribersPage,Subscribers}.tsx`):
 * newsletter sign-ups, search, CSV export, remove one or many. Keyset pages of 50 with "Load more"
 * instead of page numbers; the count is the loaded rows ("50+").
 */
const route = getRouteApi('/subscribers');
const EMPTY = new Set<string>();

export function Subscribers() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const subscribers = useInfiniteQuery(subscribersQuery(search));
  const rows = useMemo(() => subscribers.data?.pages.flatMap(page => page.items), [subscribers.data]);
  const hasNext = Boolean(subscribers.hasNextPage);
  const [busy, setBusy] = useState<string | null>(null);

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
      void navigate({search: {q: next || undefined}, replace: true, resetScroll: false});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, navigate]);

  // Selection belongs to the list as shown: a new search starts fresh.
  const listKey = search.q ?? '';
  const [sel, setSel] = useState<{key: string; ids: Set<string>}>({key: listKey, ids: EMPTY});
  const selected = sel.key === listKey ? sel.ids : EMPTY;
  const setSelected = useCallback((ids: Set<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSelected(new Set()), [setSelected]);
  const selectedRows = (rows ?? []).filter(s => selected.has(s.email));
  const allSelected = Boolean(rows?.length) && rows!.every(s => selected.has(s.email));
  const toggle = (email: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(email);
    else next.delete(email);
    setSelected(next);
  };

  const copy = (emails: string[]) =>
    copyText(emails.join(', ')).then(
      () => toast.success(emails.length === 1 ? `${emails[0]} copied` : `${plural(emails.length, 'address', 'addresses')} copied`),
      error => toast.danger(errorText(error))
    );

  const exportSelected = () => {
    saveCsv(
      csvText(['Email', 'Source', 'Subscribed'], selectedRows.map(s => [s.email, s.source ?? '', s.createdAt])),
      `varel-subscribers-selected-${selectedRows.length}.csv`
    );
    toast.success(`Exported ${plural(selectedRows.length, 'subscriber')}`);
  };

  // The whole list (or the matches) as CSV, through siteFetch: a plain link would not carry the session in the Preview.
  const exportAll = useMutation({
    mutationFn: async () => {
      const res = await siteFetch(`/site-api/manage/subscribers/export.csv${toQueryString({q: search.q})}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {message?: string} | null;
        throw new Error(body?.message ?? 'The export could not be made. Try again.');
      }
      saveBlob(await res.blob(), `varel-subscribers-${today()}.csv`);
    },
    onError: error => toast.danger(errorText(error)),
  });

  const remove = async (list: AdminSubscriber[]) => {
    const emails = list.map(s => s.email);
    await confirm({
      title: `Remove ${plural(emails.length, 'subscriber')}?`,
      body: (
        <>
          They stop receiving the newsletter. They can subscribe again from the storefront.
          <span className="subscribers-email-list">
            {emails.map(email => (
              <span key={email}>{email}</span>
            ))}
          </span>
        </>
      ),
      confirmLabel: 'Remove',
      pendingLabel: 'Removing…',
      tone: 'danger',
      action: async () => {
        setBusy(emails.length === 1 ? emails[0]! : null);
        try {
          const {done, failed} = await settle(
            emails,
            email => manage(`subscribers/${encodeURIComponent(email)}`, {method: 'DELETE'}),
            email => email
          );
          if (done.length) toast.success(`${plural(done.length, 'subscriber')} removed`);
          if (failed.length) toast.danger(`${failed.map(f => f.key).join(', ')} could not be removed: ${errorText(failed[0]!.error)}`);
          setSelected(new Set([...selected].filter(email => !done.includes(email))));
          await queryClient.invalidateQueries({queryKey: subscriberKeys.all});
          await queryClient.invalidateQueries({queryKey: ['admin', 'customers']});
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const columns: Column<AdminSubscriber>[] = [
    {
      key: 'select',
      width: 'shrink',
      header: (
        <Checkbox
          label={<span className="visually-hidden">Select all loaded subscribers</span>}
          checked={allSelected}
          disabled={!rows?.length}
          onChange={on => setSelected(on ? new Set(rows?.map(s => s.email)) : new Set())}
        />
      ),
      cell: s => <Checkbox label={<span className="visually-hidden">Select {s.email}</span>} checked={selected.has(s.email)} onChange={on => toggle(s.email, on)} />,
    },
    {key: 'email', header: 'Email', cell: s => <span className="subscribers-email">{s.email}</span>},
    {key: 'source', header: 'Source', cell: s => <span className="muted subscribers-source">{s.source ?? '—'}</span>},
    {key: 'createdAt', header: 'Subscribed', align: 'end', width: 'shrink', cell: s => <span className="muted subscribers-date">{formatDateTime(s.createdAt)}</span>},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: s => (
        <Menu
          label={`Actions for ${s.email}`}
          disabled={busy === s.email}
          items={[
            {label: 'Copy address', icon: 'copy', onSelect: () => void copy([s.email])},
            {label: 'Email', icon: 'mail', onSelect: () => window.location.assign(`mailto:${s.email}`)},
            'separator',
            {label: 'Remove…', icon: 'trash', danger: true, onSelect: () => void remove([s])},
          ]}
        />
      ),
    },
  ];

  return (
    <div className="app-page screen-subscribers">
      <PageHeader
        title="Subscribers"
        description="Newsletter sign-ups from the storefront and checkout."
        actions={
          <span className="subscribers-export">
            <Button variant="secondary" icon="download" pending={exportAll.isPending} pendingLabel="Exporting…" onClick={() => exportAll.mutate()}>
              {search.q ? 'Export matches' : 'Export CSV'}
            </Button>
            <span className="muted subscribers-hint">Up to 10,000 addresses per file.</span>
          </span>
        }
      />

      <div className="toolbar">
        <div className="toolbar-group">
          <form role="search" className="subscribers-search" noValidate onSubmit={event => event.preventDefault()}>
            <SearchInput
              label="Search subscribers"
              placeholder="Search email or source"
              value={q}
              maxLength={200}
              autoComplete="off"
              onChange={event => setQ(event.target.value)}
            />
          </form>
          {rows && (
            <span aria-live="polite" className="muted subscribers-count">
              {pageCount(rows, hasNext)} {rows.length === 1 && !hasNext ? 'subscriber' : 'subscribers'}
            </span>
          )}
        </div>
      </div>

      {subscribers.isError && !rows?.length ? (
        <Card>
          <ErrorNote error={subscribers.error} title="Subscribers could not be loaded." />
          <div className="subscribers-retry">
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => void subscribers.refetch()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <Card flush>
          <DataTable
            caption="Subscribers"
            columns={columns}
            rows={rows}
            rowKey={s => s.email}
            loading={subscribers.isPending}
            busyKey={busy}
            empty={
              search.q ? (
                <EmptyState icon="search" title="No subscribers match that search." />
              ) : (
                <EmptyState icon="mail-plus" title="No one has subscribed yet." />
              )
            }
          />
          <LoadMore query={subscribers} />
        </Card>
      )}

      {selectedRows.length > 0 && <div aria-hidden="true" className="subscribers-bulk-spacer" />}
      <BulkBar count={selectedRows.length} noun={['subscriber', 'subscribers']} onClear={clear}>
        <BulkAction icon="copy" onClick={() => void copy(selectedRows.map(s => s.email))}>
          Copy addresses
        </BulkAction>
        <BulkAction icon="download" onClick={exportSelected}>
          Export
        </BulkAction>
        <BulkAction icon="trash" danger onClick={() => void remove(selectedRows)}>
          Remove
        </BulkAction>
      </BulkBar>
    </div>
  );
}
