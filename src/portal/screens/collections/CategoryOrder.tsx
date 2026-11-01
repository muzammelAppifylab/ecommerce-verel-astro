import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useMemo, useState} from 'react';

import {money} from '../../../lib/format';
import type {AdminProductRow} from '../../../lib/types/admin/catalog';
import {categoryOrderQuery, collectionDepartmentsQuery, merchKeys, saveCategoryOrder} from '../../queries/collections';
import {Button, ErrorNote, Field, Icon, PageHeader, Select, SortableList, buttonClass, useToast} from '../../ui';
import {MerchTabs, ProductStatusBadge, RowSkeletons, Thumb, productCount, useMerchReadOnly} from './shared';

/**
 * `/dashboard/collections/category-order`: the manual product order inside a category. The storefront
 * "Featured" sort on category pages follows it (`Product.categoryPosition`). VAREL `CategoryOrder.tsx`.
 */
export function CategoryOrder() {
  const readOnly = useMerchReadOnly();
  const toast = useToast();
  const queryClient = useQueryClient();
  const departments = useQuery(collectionDepartmentsQuery());
  const options = useMemo(
    () =>
      [...(departments.data ?? [])]
        .sort((a, b) => a.position - b.position)
        .flatMap(d =>
          [...d.categories]
            .sort((a, b) => a.position - b.position)
            .map(c => ({value: c.id, label: `${d.name} · ${c.name} (${c.productCount})`, count: c.productCount}))
        ),
    [departments.data]
  );
  const [category, setCategory] = useState('');
  // Start on the first category with something to order.
  useEffect(() => {
    if (!category && options.length) setCategory((options.find(o => o.count > 1) ?? options[0])!.value);
  }, [options, category]);

  const order = useQuery(categoryOrderQuery(category));
  const [items, setItems] = useState<AdminProductRow[]>([]);
  useEffect(() => setItems(order.data?.products ?? []), [order.data]);
  const cat = order.data?.category;

  const save = useMutation({
    mutationFn: saveCategoryOrder,
    onSuccess: (next, input) => {
      queryClient.setQueryData(merchKeys.categoryOrder(input.category), next);
      void queryClient.invalidateQueries({queryKey: ['admin', 'products']});
    },
  });

  const onReorder = (next: AdminProductRow[]) => {
    const prev = items;
    setItems(next);
    save.mutate(
      {category, productIds: next.map(p => p.id)},
      {
        onSuccess: () => toast.success('Order saved'),
        onError: error => {
          setItems(prev);
          toast.danger(error.message);
        },
      }
    );
  };

  return (
    <div className="app-page screen-collections">
      <PageHeader title="Collections" description="Set the order products appear in on a category page when shoppers sort by Featured." />
      <MerchTabs />

      <div className="merch-toolbar">
        <div className="merch-category-field">
          <Field label="Category" id="order-category">
            <Select
              id="order-category"
              value={category}
              disabled={departments.isPending || !options.length}
              onChange={e => setCategory(e.target.value)}
              options={category ? options : [{value: '', label: 'Choose a category'}, ...options]}
            />
          </Field>
        </div>
        {cat && (
          <a href={`/shop/${cat.deptSlug}/${cat.slug}/`} target="_blank" rel="noopener noreferrer" className={buttonClass({variant: 'ghost', size: 'sm'})}>
            <Icon name="external" size={16} />
            View {cat.name} on the store
          </a>
        )}
      </div>

      {departments.isError ? (
        <div className="merch-error">
          <ErrorNote title="Categories could not be loaded" error={departments.error} />
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void departments.refetch()} pending={departments.isFetching} pendingLabel="Retrying…">
            Try again
          </Button>
        </div>
      ) : order.isError ? (
        <div className="merch-error">
          <ErrorNote title="This category could not be loaded" error={order.error} />
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void order.refetch()} pending={order.isFetching} pendingLabel="Retrying…">
            Try again
          </Button>
        </div>
      ) : order.isPending || !category ? (
        <RowSkeletons rows={4} />
      ) : items.length === 0 ? (
        <div className="merch-list">
          <p className="merch-products-empty">No products in this category yet.</p>
        </div>
      ) : (
        <>
          <p className="merch-line">
            {productCount(items.length)} in {cat?.dept} · {cat?.name}.{' '}
            {items.length < 2
              ? 'Add another product to this category to change the order.'
              : !readOnly && 'Drag a row, or use the arrows. Changes save straight away.'}
            {items.length >= 100 && ' Only the first 100 products are shown and ordered.'}
          </p>
          <div className="merch-list" data-pending={save.isPending ? '' : undefined} aria-busy={save.isPending || undefined}>
            <SortableList
              label={`Products in ${cat?.name ?? 'this category'}`}
              items={items}
              disabled={readOnly || save.isPending}
              getKey={p => p.id}
              getLabel={p => p.name}
              onReorder={onReorder}
              renderItem={p => (
                <div className="merch-row">
                  <Thumb src={p.image?.src} />
                  <div className="merch-row-text">
                    <p className="merch-row-name">{p.name}</p>
                    <p className="merch-row-meta">
                      {p.sku} · {money(p.price)}
                    </p>
                  </div>
                  {p.status !== 'published' && <ProductStatusBadge status={p.status} />}
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
