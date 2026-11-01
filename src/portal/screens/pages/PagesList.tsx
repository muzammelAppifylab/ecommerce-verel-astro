/* /dashboard/pages — the copy of the store's pages (privacy, terms, /pages/:slug). Pages themselves are created
   in code. Port of VAREL `src/pages/admin/pages/PagesList.tsx` on the portal kit. */
import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import {storefrontPagePath} from '../../../components/pages/policy';
import type {AdminPageRow} from '../../../lib/types/admin/content';
import {pagesQuery} from '../../queries/pages';
import {Button, type Column, DataTable, EmptyState, Icon, Notice, PageHeader, StatusBadge} from '../../ui';
import {dateTime} from './format';

const COLUMNS: Column<AdminPageRow>[] = [
  {
    key: 'title',
    header: 'Page',
    cell: p => (
      <div className="cms-page-cell">
        <Link to="/pages/$id" params={{id: p.id}} className="cell-title">
          {p.title}
        </Link>
        <span className="cell-sub">{storefrontPagePath(p.slug)}</span>
      </div>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 'shrink',
    cell: p => (p.published ? <StatusBadge tone="success">Published</StatusBadge> : <StatusBadge tone="neutral">Hidden</StatusBadge>),
  },
  {
    key: 'seo',
    header: 'Search',
    width: 'shrink',
    hideOnMobile: true,
    cell: p => <span className="muted">{p.seoTitle || p.seoDescription ? 'Custom' : 'Default'}</span>,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: 'shrink',
    cell: p => <span className="muted cms-nowrap">{dateTime(p.updatedAt)}</span>,
  },
  {
    key: 'view',
    header: 'View',
    actions: true,
    cell: p =>
      p.published ? (
        <a href={storefrontPagePath(p.slug)} target="_blank" rel="noopener noreferrer" className="cms-view-link">
          View <Icon name="external" size={14} />
          <span className="visually-hidden">{p.title} on the store (opens in a new tab)</span>
        </a>
      ) : null,
  },
];

export function PagesList() {
  const {data, isPending, error, refetch, isRefetching} = useQuery(pagesQuery);

  return (
    <div className="cms-screen">
      <PageHeader title="Pages" description="The words on the store's own pages: privacy, terms and the rest. New pages are designed and built in code." />
      {error && !data ? (
        <Notice
          tone="danger"
          title="The pages did not load."
          action={
            <Button variant="secondary" size="sm" pending={isRefetching} pendingLabel="Trying…" onClick={() => void refetch()}>
              Try again
            </Button>
          }>
          {error.message}
        </Notice>
      ) : (
        <DataTable
          caption="Pages"
          columns={COLUMNS}
          rows={data}
          rowKey={p => p.id}
          loading={isPending}
          empty={<EmptyState icon="files" title="No editable pages yet">The storefront shows its built-in privacy and terms copy.</EmptyState>}
        />
      )}
    </div>
  );
}
