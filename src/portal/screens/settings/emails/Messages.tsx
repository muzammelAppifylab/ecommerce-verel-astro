import {useInfiniteQuery, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState, type FormEvent} from 'react';

import type {AdminEmailMessage} from '../../../../lib/types/admin/emails';
import {hasAbility} from '../../../api';
import {
  emailCountsQuery,
  emailMessageQuery,
  emailMessagesQuery,
  emailTemplatesQuery,
  resendEmail,
  type EmailsSearch,
  type EmailStatus,
} from '../../../queries/emails';
import {useMe} from '../../../shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  LoadMore,
  Drawer,
  Notice,
  SearchInput,
  SegmentedControl,
  Select,
  StatusBadge,
  LoadingBlock,
  useToast,
} from '../../../ui';
import {EmailFrame} from './EmailFrame';
import {formatDateTime, providerLabel, STATUS_LABEL, STATUS_TONES} from './labels';

/*
 * Outbox and send log: every EmailMessage, filterable by status and template, with a message viewer.
 * WP-22: port of VAREL src/pages/admin/emails/Messages.tsx (pages → keyset "Load more", viewer dialog → Drawer).
 */

const ALL = 'all';
const FILTERS: {id: EmailStatus | typeof ALL; label: string}[] = [
  {id: ALL, label: 'All'},
  {id: 'stored', label: 'Outbox'},
  {id: 'sent', label: 'Sent'},
  {id: 'failed', label: 'Failed'},
  {id: 'skipped', label: 'Skipped'},
];

export function Messages({search, set}: {search: EmailsSearch; set: (p: Partial<EmailsSearch>) => void}) {
  const templates = useQuery(emailTemplatesQuery).data;
  const counts = useQuery(emailCountsQuery).data;
  const nameOf = (key: string | null) => (key ? (templates?.find(t => t.key === key)?.name ?? key) : 'Message');
  const list = useInfiniteQuery(emailMessagesQuery({status: search.status, template: search.template, q: search.q}));
  const rows = list.data?.pages.flatMap(p => p.items);
  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => setQ(search.q ?? ''), [search.q]);

  const filtered = !!(search.status || search.template || search.q);
  const countOf = (s: EmailStatus) => {
    const n = counts?.[s];
    if (!n) return null;
    return counts?.capped.includes(s) ? '100+' : String(n);
  };

  const columns: Column<AdminEmailMessage>[] = [
    {key: 'to', header: 'To', hideOnMobile: true, cell: m => <span className="emails-truncate">{m.to}</span>},
    {
      key: 'subject',
      header: 'Email',
      cell: m => (
        <button type="button" className="emails-row-open" onClick={() => set({id: m.id})} aria-label={`Open ${m.subject} to ${m.to}`}>
          <span className="emails-row-subject">{m.subject}</span>
          <span className="emails-row-template">{nameOf(m.template)}</span>
          <span className="emails-row-mobile">
            <span className={m.status === 'failed' ? 'emails-text-danger' : undefined}>{STATUS_LABEL[m.status] ?? m.status}</span> · {m.to} ·{' '}
            {formatDateTime(m.createdAt)}
          </span>
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'shrink',
      hideOnMobile: true,
      cell: m => <StatusBadge tone={STATUS_TONES[m.status] ?? 'neutral'}>{STATUS_LABEL[m.status] ?? m.status}</StatusBadge>,
    },
    {key: 'provider', header: 'Provider', width: 'shrink', hideOnMobile: true, cell: m => providerLabel(m.provider)},
    {
      key: 'createdAt',
      header: 'Date',
      align: 'end',
      width: 'shrink',
      hideOnMobile: true,
      cell: m => <span className="emails-nowrap">{formatDateTime(m.createdAt)}</span>,
    },
  ];

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    set({q: q.trim() || undefined, page: undefined, id: undefined});
  };

  return (
    <>
      <div className="emails-filters">
        <SegmentedControl
          label="Filter by status"
          value={search.status ?? ALL}
          onChange={v => set({status: v === ALL ? undefined : v, page: undefined})}
          options={FILTERS.map(f => ({
            value: f.id,
            label: (
              <>
                {f.label}
                {f.id !== ALL && countOf(f.id) ? <span className="emails-filter-count">{countOf(f.id)}</span> : null}
              </>
            ),
          }))}
        />
        <div className="emails-filters-end">
          <Select
            aria-label="Filter by template"
            value={search.template ?? ALL}
            onChange={e => set({template: e.target.value === ALL ? undefined : e.target.value, page: undefined})}
            options={[{value: ALL, label: 'All templates'}, ...(templates ?? []).map(t => ({value: t.key, label: t.name}))]}
          />
          <form role="search" noValidate onSubmit={submitSearch}>
            <SearchInput label="Search recipient or subject" placeholder="Search recipient or subject" value={q} onChange={e => setQ(e.target.value)} />
          </form>
        </div>
      </div>

      {list.error && !rows?.length ? (
        <div className="emails-error">
          <ErrorNote error={list.error} title="Emails could not be loaded" />
          <Button variant="secondary" size="sm" pending={list.isRefetching} pendingLabel="Trying again…" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <DataTable
            caption="Emails"
            columns={columns}
            rows={rows}
            rowKey={m => m.id}
            loading={list.isLoading}
            empty={
              <EmptyState
                icon="mail"
                title={filtered ? 'No emails match these filters' : 'No emails yet'}
                action={
                  filtered ? (
                    <Button variant="secondary" onClick={() => set({status: undefined, template: undefined, q: undefined, page: undefined})}>
                      Clear filters
                    </Button>
                  ) : undefined
                }>
                {filtered
                  ? 'Try another status or template, or clear the search.'
                  : 'Order updates, return updates and alerts appear here as the store sends them.'}
              </EmptyState>
            }
          />
          <LoadMore query={list} />
        </>
      )}

      <MessageViewer id={search.id} nameOf={nameOf} onClose={() => set({id: undefined})} onOpen={id => set({id})} />
    </>
  );
}

function MessageViewer({
  id,
  nameOf,
  onClose,
  onOpen,
}: {
  id: string | undefined;
  nameOf: (key: string | null) => string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const me = useMe().data;
  const canWrite = hasAbility(me?.abilities, 'manageStoreSettings');
  const {data: m, isLoading, error} = useQuery({...emailMessageQuery(id ?? ''), enabled: !!id});
  const [format, setFormat] = useState<'html' | 'text'>('html');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => setSendError(null), [id]);

  async function again() {
    if (!m) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await resendEmail(qc, m.id);
      qc.setQueryData(emailMessageQuery(r.id).queryKey, r);
      if (r.status === 'failed') toast.danger(`Sending failed again: ${r.error ?? 'unknown error'}`);
      else toast.success(r.status === 'stored' ? 'Copied to the outbox' : `Email ${STATUS_LABEL[r.status].toLowerCase()} to ${r.to}`);
      onOpen(r.id);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      dismissible={!sending}
      title={m ? nameOf(m.template) : 'Email'}
      description="The email as it was rendered and sent"
      footer={
        m && canWrite ? (
          <div className="emails-viewer-foot">
            {sendError ? <p className="field-error" role="alert">{sendError}</p> : <p className="emails-muted">Sends a copy through the current provider.</p>}
            <Button variant="secondary" size="sm" icon="rotate-ccw" pending={sending} pendingLabel="Sending…" onClick={() => void again()}>
              {m.status === 'failed' ? 'Try again' : 'Send again'}
            </Button>
          </div>
        ) : undefined
      }>
      {error ? (
        <ErrorNote error={error} />
      ) : isLoading || !m ? (
        <LoadingBlock rows={3} />
      ) : (
        <div className="emails-viewer">
          <dl className="emails-viewer-meta">
            <dt>To</dt>
            <dd className="emails-break">{m.to}</dd>
            <dt>Subject</dt>
            <dd>{m.subject}</dd>
            <dt>Status</dt>
            <dd className="emails-status-line">
              <StatusBadge tone={STATUS_TONES[m.status] ?? 'neutral'}>{STATUS_LABEL[m.status] ?? m.status}</StatusBadge>
              <span className="emails-muted">
                {providerLabel(m.provider)} · {formatDateTime(m.sentAt ?? m.createdAt)}
              </span>
            </dd>
            {m.providerId && (
              <>
                <dt>Provider id</dt>
                <dd className="emails-mono emails-break">{m.providerId}</dd>
              </>
            )}
            {m.attempts > 0 && (
              <>
                <dt>Tries</dt>
                <dd>{m.attempts === 1 ? '1 try' : `${m.attempts} tries`}</dd>
              </>
            )}
          </dl>
          {m.error && <Notice tone={m.status === 'failed' ? 'danger' : 'info'}>{m.error}</Notice>}
          <div className="emails-viewer-toggle">
            <SegmentedControl
              label="Show as"
              value={format}
              onChange={setFormat}
              options={[
                {value: 'html', label: 'HTML'},
                {value: 'text', label: 'Plain text'},
              ]}
            />
          </div>
          {format === 'text' ? (
            <pre className="emails-text">{m.text}</pre>
          ) : (
            <EmailFrame html={m.html} title={`Email to ${m.to}`} minHeight={560} />
          )}
        </div>
      )}
    </Drawer>
  );
}
