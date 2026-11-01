/* One language's translations (VAREL Languages.tsx `Workspace`): its coverage, "Translate N missing", removing the
   language, the filters (word, content type, status) and every text as a keyset-paged table. */
import {useInfiniteQuery} from '@tanstack/react-query';
import {useEffect, useState} from 'react';

import type {TranslationRow, TranslationsStatus} from '../../../../lib/types/admin/translations';
import {
  TRANSLATION_STATUSES,
  translationsListQuery,
  useUpdateLanguageSettings,
  type TranslationsSearch,
  type TranslationStatus,
} from '../../../queries/languages';
import {Button, DataTable, EmptyState, LoadMore, Menu, Notice, SearchInput, SegmentedControl, Select, useConfirm, useToast, type Column} from '../../../ui';
import {entityLabel, languageName, STATUS_LABEL, todo} from './labels';
import {RowActions, rowKey, SourceCell, TranslationCell, WhereCell} from './TranslationRow';

const ALL = 'all';

export function Workspace({
  status: s,
  locale,
  search,
  set,
  busy,
  canWrite,
  canEditLanguages,
  onTranslateMissing,
  onRemoved,
}: {
  status: TranslationsStatus;
  locale: string;
  search: TranslationsSearch;
  set: (patch: Partial<TranslationsSearch>) => void;
  busy: boolean;
  canWrite: boolean;
  canEditLanguages: boolean;
  onTranslateMissing: () => void;
  onRemoved: () => void;
}) {
  const update = useUpdateLanguageSettings();
  const confirm = useConfirm();
  const toast = useToast();
  const c = s.totals[locale];
  const left = todo(c);
  const name = languageName(locale);
  const source = languageName(s.defaultLocale);
  const list = useInfiniteQuery(translationsListQuery({entity: search.entity, locale, status: search.status, q: search.q}));
  const rows = list.data?.pages.flatMap(p => p.items);
  const filtered = !!(search.entity || search.status || search.q);
  const [editing, setEditing] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // The word filter follows typing after a short pause.
  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => setQ(search.q ?? ''), [search.q]);
  useEffect(() => {
    if ((search.q ?? '') === q.trim()) return;
    const t = window.setTimeout(() => set({q: q.trim() || undefined}), 250);
    return () => window.clearTimeout(t);
  }, [q, search.q, set]);

  const remove = () =>
    void confirm({
      title: `Remove ${name}?`,
      body: `${name} disappears from the language switcher. Its translations are kept, so adding it back restores them.`,
      confirmLabel: `Remove ${name}`,
      pendingLabel: 'Removing…',
      action: () => update.mutateAsync({locales: [s.defaultLocale, ...s.locales.filter(l => l !== locale && l !== s.defaultLocale)]}),
    })
      .then(ok => {
        if (!ok) return;
        toast.success(`${name} removed`);
        onRemoved();
      })
      .catch((e: unknown) => toast.danger(e instanceof Error ? e.message : 'The language could not be removed'));

  const columns: Column<TranslationRow>[] = [
    {key: 'where', header: 'Where', cell: r => <WhereCell row={r} />},
    {key: 'source', header: source, cell: r => <SourceCell row={r} />},
    {
      key: 'value',
      header: name,
      cell: r => (
        <TranslationCell
          row={r}
          canWrite={canWrite}
          editing={editing === rowKey(r)}
          disabled={busyKey === rowKey(r)}
          onEdit={() => setEditing(rowKey(r))}
          onDone={() => setEditing(null)}
        />
      ),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: 'Actions',
            actions: true,
            cell: (r: TranslationRow) => (
              <RowActions row={r} busy={busyKey === rowKey(r)} disabled={editing === rowKey(r) || (busyKey !== null && busyKey !== rowKey(r))} onBusy={setBusyKey} />
            ),
          } satisfies Column<TranslationRow>,
        ]
      : []),
  ];

  return (
    <section className="lang-workspace" aria-label={`${name} translations`}>
      <div className="lang-workspace-head">
        <div>
          <h3 className="lang-workspace-title">{name}</h3>
          <p className="lang-workspace-stats">
            {c ? `${c.translated} of ${c.total} texts translated` : '…'}
            {c && c.missing > 0 && ` · ${c.missing} missing`}
            {c && c.stale > 0 && ` · ${c.stale} outdated`}
            {c && c.manual > 0 && ` · ${c.manual} edited by hand`}
          </p>
        </div>
        <div className="lang-workspace-actions">
          {canWrite && s.provider !== 'none' && (
            <Button variant={left ? 'primary' : 'secondary'} pending={busy} pendingLabel="Translating…" disabled={!left} onClick={onTranslateMissing}>
              {left ? `Translate ${left} missing` : 'All translated'}
            </Button>
          )}
          {canEditLanguages && <Menu label={`More for ${name}`} items={[{label: `Remove ${name}`, icon: 'trash', danger: true, onSelect: remove}]} />}
        </div>
      </div>

      {canWrite && s.provider !== 'none' && s.providerReady === false && (
        <Notice tone="warning" title="The translation provider is not set up">
          Nothing is machine-translated until its secrets are added. See Setup.
        </Notice>
      )}

      <div className="lang-filters">
        <SearchInput
          label="Find a word"
          value={q}
          placeholder={`Find a word in ${source} or ${name}`}
          maxLength={200}
          onChange={event => setQ(event.target.value)}
        />
        <Select
          aria-label="Content"
          value={search.entity ?? ALL}
          onChange={event => set({entity: event.target.value === ALL ? undefined : event.target.value})}
          options={[
            {value: ALL, label: 'All content'},
            ...s.entities
              .filter(e => e.locales[locale])
              .map(e => {
                const n = todo(e.locales[locale]);
                return {value: e.entity, label: `${entityLabel(e.entity)}${n ? ` · ${n} to do` : ''}`};
              }),
          ]}
        />
        <SegmentedControl
          label="Show"
          value={(search.status ?? ALL) as TranslationStatus | typeof ALL}
          onChange={v => set({status: v === ALL ? undefined : v})}
          options={[{value: ALL, label: 'All'}, ...TRANSLATION_STATUSES.map(st => ({value: st, label: STATUS_LABEL[st]}))]}
        />
      </div>

      {list.isError && !rows?.length ? (
        <EmptyState icon="alert" title="The list could not be loaded" action={<Button variant="secondary" onClick={() => void list.refetch()}>Try again</Button>}>
          {list.error.message}
        </EmptyState>
      ) : (
        <div className={list.isFetching && !list.isFetchingNextPage && rows ? 'lang-table is-fetching' : 'lang-table'}>
          <DataTable
            caption={`${name} translations`}
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            loading={list.isPending}
            busyKey={busyKey}
            empty={
              <EmptyState
                icon={filtered ? 'search' : 'check-circle'}
                title={filtered ? 'Nothing matches' : `${name} is fully translated`}
                action={
                  filtered ? (
                    <Button variant="secondary" onClick={() => set({entity: undefined, status: undefined, q: undefined})}>
                      Clear filters
                    </Button>
                  ) : undefined
                }>
                {filtered ? 'Try another word, or show all content.' : 'New content will appear here as it is added.'}
              </EmptyState>
            }
          />
          <LoadMore query={list} />
        </div>
      )}
    </section>
  );
}
