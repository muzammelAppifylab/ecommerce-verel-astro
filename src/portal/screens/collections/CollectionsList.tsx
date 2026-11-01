import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import type {AdminCollectionRow} from '../../../lib/types/admin/merchandising';
import {
  collectionSaved,
  collectionDeleted,
  collectionsQuery,
  deleteCollection,
  merchKeys,
  reorderCollections,
  saveCollection,
} from '../../queries/collections';
import {Badge, Button, EmptyState, ErrorNote, Icon, IconButton, PageHeader, SortableList, StatusBadge, Switch, buttonClass, useConfirm, useToast} from '../../ui';
import {MerchTabs, RowSkeletons, Thumb, productCount, useMerchReadOnly} from './shared';

/** `/dashboard/collections`: every collection in merchandising order (VAREL `CollectionsList`). */
export function CollectionsList() {
  const readOnly = useMerchReadOnly();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const list = useQuery(collectionsQuery());
  const rows = list.data ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  const reorder = useMutation({
    mutationFn: reorderCollections,
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({queryKey: merchKeys.collections, exact: true});
      const prev = queryClient.getQueryData<AdminCollectionRow[]>(merchKeys.collections);
      if (prev) {
        const byId = new Map(prev.map(c => [c.id, c]));
        queryClient.setQueryData(
          merchKeys.collections,
          ids.flatMap((id, position) => {
            const c = byId.get(id);
            return c ? [{...c, position}] : [];
          })
        );
      }
      return {prev};
    },
    onError: (error, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(merchKeys.collections, ctx.prev);
      toast.danger(error.message);
    },
    onSuccess: next => queryClient.setQueryData(merchKeys.collections, next),
  });

  const patch = useMutation({
    mutationFn: ({id, ...body}: {id: string; published?: boolean; featuredOnHome?: boolean}) => saveCollection(id, body),
    onMutate: ({id}) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: c => collectionSaved(queryClient, c),
  });

  const toggle = (c: AdminCollectionRow, field: 'published' | 'featuredOnHome', value: boolean) =>
    patch.mutate(
      {id: c.id, [field]: value},
      {
        onSuccess: () =>
          toast.success(
            field === 'published'
              ? value
                ? `${c.title} is live`
                : `${c.title} is hidden`
              : value
                ? `${c.title} is featured on the home page`
                : `${c.title} is no longer on the home page`
          ),
        onError: error => toast.danger(error.message),
      }
    );

  const remove = async (c: AdminCollectionRow) => {
    const done = await confirm({
      title: `Delete ${c.title}?`,
      body: 'The collection page stops working. The products themselves are not changed.',
      confirmLabel: 'Delete collection',
      pendingLabel: 'Deleting…',
      action: async () => {
        await deleteCollection(c.id);
        collectionDeleted(queryClient, c.id);
      },
    });
    if (done) toast.success(`${c.title} deleted`);
  };

  const newButton = !readOnly && (
    <Link to="/collections/$id" params={{id: 'new'}} className={buttonClass({size: 'sm'})}>
      <Icon name="plus" size={16} />
      New collection
    </Link>
  );

  return (
    <div className="app-page screen-collections">
      <PageHeader
        title="Collections"
        description="Curated sets of products with their own page. Drag to set the order on the storefront and the home page."
        actions={newButton}
      />
      <MerchTabs />

      {list.isPending ? (
        <RowSkeletons rows={3} />
      ) : list.isError ? (
        <div className="merch-error">
          <ErrorNote title="Collections could not be loaded" error={list.error} />
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void list.refetch()} pending={list.isFetching} pendingLabel="Retrying…">
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="merch-list">
          <EmptyState icon="layers" title="No collections yet" action={newButton}>
            Group products into an edit, such as a season or an occasion. Each collection gets its own page.
          </EmptyState>
        </div>
      ) : (
        <div className="merch-list" data-pending={reorder.isPending ? '' : undefined}>
          <div className="merch-list-head" aria-hidden="true">
            <span className="merch-head-thumb" />
            <span className="merch-head-name">Collection</span>
            <span className="merch-head-toggle">Published</span>
            <span className="merch-head-toggle">On home</span>
            <span className={readOnly ? 'merch-head-actions-ro' : 'merch-head-actions'} />
          </div>
          <SortableList
            label="Collections"
            items={rows}
            disabled={readOnly}
            getKey={c => c.id}
            getLabel={c => c.title}
            onReorder={next => reorder.mutate(next.map(c => c.id))}
            renderItem={c => (
              <div className="merch-row">
                <Thumb src={c.image?.src} />
                <div className="merch-row-text">
                  <Link to="/collections/$id" params={{id: c.id}} className="merch-row-title">
                    {c.title}
                  </Link>
                  <p className="merch-row-meta">
                    /collections/{c.slug}/ · {productCount(c.productCount)}
                  </p>
                  <div className="merch-row-badges">
                    <StatusBadge tone={c.published ? 'success' : 'neutral'}>{c.published ? 'Published' : 'Hidden'}</StatusBadge>
                    {c.featuredOnHome && <Badge tone="brand">On home</Badge>}
                  </div>
                </div>
              </div>
            )}
            renderActions={c => (
              <>
                <span className="merch-toggle-cell">
                  <Switch
                    label={<span className="visually-hidden">Publish {c.title}</span>}
                    checked={c.published}
                    disabled={readOnly || (busyId !== null && busyId !== c.id)}
                    pending={busyId === c.id}
                    onChange={v => toggle(c, 'published', v)}
                  />
                </span>
                <span className="merch-toggle-cell">
                  <Switch
                    label={<span className="visually-hidden">Feature {c.title} on the home page</span>}
                    checked={c.featuredOnHome}
                    disabled={readOnly || (busyId !== null && busyId !== c.id)}
                    pending={busyId === c.id}
                    onChange={v => toggle(c, 'featuredOnHome', v)}
                  />
                </span>
                <span className="merch-row-actions">
                  {c.published && (
                    <a
                      href={`/collections/${c.slug}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${buttonClass({variant: 'ghost', size: 'sm'})} icon-button`}
                      aria-label={`View ${c.title} on the store`}
                      title={`View ${c.title} on the store`}>
                      <Icon name="external" size={16} />
                    </a>
                  )}
                  <Link
                    to="/collections/$id"
                    params={{id: c.id}}
                    className={`${buttonClass({variant: 'ghost', size: 'sm'})} icon-button`}
                    aria-label={`Edit ${c.title}`}
                    title={`Edit ${c.title}`}>
                    <Icon name="pencil" size={16} />
                  </Link>
                  {!readOnly && (
                    <IconButton
                      icon="trash"
                      size="sm"
                      variant="danger"
                      label={`Delete ${c.title}`}
                      disabled={busyId === c.id}
                      onClick={() => void remove(c)}
                    />
                  )}
                </span>
              </>
            )}
          />
        </div>
      )}
    </div>
  );
}
