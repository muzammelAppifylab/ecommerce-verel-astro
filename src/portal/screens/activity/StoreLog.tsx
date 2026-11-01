import {useInfiniteQuery} from '@tanstack/react-query';
import {useEffect, useRef, useState} from 'react';

import type {AdminActivityRow} from '../../../lib/types/admin/staff';
import {siteFetch} from '../../../platform/browser';
import {type ActivitySearch, activityCsvPath, activityQuery} from '../../queries/activity';
import {pageCount, when} from '../../shared';
import {
  Badge,
  Button,
  Card,
  type Column,
  DataTable,
  DateRangeFilter,
  EmptyState,
  ErrorNote,
  LoadMore,
  SearchInput,
  Select,
  Skeleton,
  useToast,
} from '../../ui';

/** VAREL `sentence`. */
export const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const COLUMNS: Column<AdminActivityRow>[] = [
  {
    key: 'at',
    header: 'When',
    width: 'shrink',
    cell: r => (
      <time className="muted nowrap tabular" dateTime={r.at}>
        {when(r.at)}
      </time>
    ),
  },
  {key: 'actor', header: 'Staff', width: 'shrink', cell: r => <span className="nowrap">{r.actor.name}</span>},
  {key: 'summary', header: 'What happened', cell: r => r.summary},
  {key: 'entity', header: 'Type', width: 'shrink', cell: r => <Badge>{sentence(r.entity)}</Badge>},
];

/** The filename from `Content-Disposition`, or VAREL's default. */
const fileNameOf = (res: Response) =>
  /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
  `varel-activity-${new Date().toISOString().slice(0, 10)}.csv`;

/**
 * The store's activity log (VAREL src/pages/admin/staff/ActivityPage.tsx): every change made in the admin, in
 * words, newest first, with search, staff, type and date filters and a CSV export. The filters live in the URL.
 */
export function StoreLog({search, onSearch}: {search: ActivitySearch; onSearch: (patch: Partial<ActivitySearch> | null) => void}) {
  const activity = useInfiniteQuery(activityQuery(search));
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  // The search box writes `q` 300 ms after the last keystroke.
  const [q, setQ] = useState(search.q ?? '');
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => onSearch({q: q.trim() || undefined}), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    if (!typed.current) setQ(search.q ?? '');
  }, [search.q]);

  const pages = activity.data?.pages;
  const rows = pages?.flatMap(p => p.items);
  const first = pages?.[0];
  const filtered = Boolean(search.q || search.actor || search.entity || search.from || search.to);
  const actorOptions = (first?.actors ?? []).map(a => ({value: a.id, label: a.name}));
  const entityOptions = (first?.entities ?? []).map(e => ({value: e, label: sentence(e)}));
  const count = pageCount(rows, Boolean(activity.hasNextPage));

  const clear = () => {
    typed.current = false;
    setQ('');
    onSearch(null);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await siteFetch(activityCsvPath(search));
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameOf(res);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.danger('The export could not be downloaded');
    } finally {
      setExporting(false);
    }
  };

  const emptyText = filtered ? 'No activity matches these filters.' : 'Nothing recorded yet. Changes made in the admin show up here.';
  const empty = (
    <EmptyState
      icon={filtered ? 'search' : 'activity'}
      title={emptyText}
      action={
        filtered ? (
          <Button variant="secondary" icon="x" onClick={clear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <>
      <div className="activity-head">
        <p className="activity-intro">{count === null ? ' ' : `${count} ${count === '1' ? 'change' : 'changes'}${filtered ? ' match these filters' : ' recorded'}`}</p>
        <Button variant="secondary" icon="download" pending={exporting} pendingLabel="Preparing…" onClick={() => void exportCsv()} title="Up to 10,000 rows">
          Export CSV
        </Button>
      </div>

      <div className="toolbar activity-filters">
        <SearchInput
          label="Search activity"
          placeholder="Search activity"
          value={q}
          maxLength={200}
          onChange={event => {
            typed.current = true;
            setQ(event.target.value);
          }}
        />
        <Select
          aria-label="Staff"
          value={search.actor ?? ''}
          disabled={!actorOptions.length && !search.actor}
          options={[{value: '', label: 'Everyone'}, ...actorOptions]}
          onChange={event => onSearch({actor: event.target.value || undefined})}
        />
        <Select
          aria-label="Type"
          value={search.entity ?? ''}
          disabled={!entityOptions.length && !search.entity}
          options={[{value: '', label: 'Every type'}, ...entityOptions]}
          onChange={event => onSearch({entity: event.target.value || undefined})}
        />
        <DateRangeFilter from={search.from} to={search.to} onChange={({from, to}) => onSearch({from, to})} />
        {filtered && (
          <Button variant="link" icon="x" onClick={clear}>
            Clear filters
          </Button>
        )}
        {activity.isFetching && !activity.isPending && !activity.isFetchingNextPage && <span className="muted activity-updating">Updating…</span>}
      </div>

      {activity.error && !rows?.length ? (
        <Card>
          <div className="form-stack">
            <ErrorNote error={activity.error} title="Activity could not be loaded" />
            <div>
              <Button variant="secondary" icon="refresh" pending={activity.isFetching} pendingLabel="Trying…" onClick={() => void activity.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card flush className="activity-table">
            <DataTable caption="Store activity" columns={COLUMNS} rows={rows} rowKey={r => r.id} loading={activity.isPending} empty={empty} />
          </Card>
          {/* Phones: one entry per row, summary first. */}
          <Card flush className="activity-phone">
            {activity.isPending ? (
              <ul className="activity-list" aria-busy="true">
                {Array.from({length: 6}, (_, i) => (
                  <li key={i}>
                    <Skeleton lines={2} />
                  </li>
                ))}
              </ul>
            ) : rows?.length ? (
              <ul className="activity-list">
                {rows.map(r => (
                  <li key={r.id}>
                    <p className="activity-list-summary">{r.summary}</p>
                    <p className="activity-list-meta">
                      {r.actor.name} · {when(r.at)} · {sentence(r.entity)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              empty
            )}
          </Card>
          {activity.error && rows?.length ? <ErrorNote error={activity.error} /> : null}
          <LoadMore query={activity} />
        </>
      )}
    </>
  );
}
