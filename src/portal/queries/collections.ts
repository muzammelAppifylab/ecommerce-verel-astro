import {type QueryClient, queryOptions} from '@tanstack/react-query';

import type {AdminCollection, AdminCollectionInput, AdminCollectionRow, CategoryOrder} from '../../lib/types/admin/merchandising';
import type {AdminDepartment, AdminProductRow} from '../../lib/types/admin/catalog';
import type {CursorPage} from '../../lib/types/common';
import {manage} from '../api';

/**
 * Collections (`/dashboard/collections`, `/$id`, `/category-order`). WP-05 owns
 * this file (`/site-api/manage/collections`). Port of VAREL src/lib/admin/merchandising.ts
 * (collections + category order; the abandoned-bag half is WP-24's).
 *
 * Every name here is prefixed (`collection…`, `merch…`): `src/portal/queries.ts` re-exports
 * every area's file with `export *`, so names must not clash with other areas.
 */

/** VAREL `merchKeys` (same shapes). */
export const merchKeys = {
  collections: ['admin', 'collections'] as const,
  collection: (id: string) => ['admin', 'collections', 'detail', id] as const,
  categoryOrder: (category: string) => ['admin', 'category-order', category] as const,
  /** The category select (WP-18's departments, read here under our own key). */
  departments: ['admin', 'collections', 'departments'] as const,
  /** The editor's product picker (WP-17's product list, read here under our own key). */
  productPicker: (q: string) => ['admin', 'collections', 'product-picker', q] as const,
};

const enc = encodeURIComponent;

export const collectionsQuery = () =>
  queryOptions({
    queryKey: merchKeys.collections,
    queryFn: ({signal}) => manage<AdminCollectionRow[]>('collections', {signal}),
  });

export const collectionQuery = (id: string) =>
  queryOptions({
    queryKey: merchKeys.collection(id),
    queryFn: ({signal}) => manage<AdminCollection>(`collections/${enc(id)}`, {signal}),
    retry: (count, error) => (error as {status?: number}).status !== 404 && count < 2,
  });

export const categoryOrderQuery = (category: string) =>
  queryOptions({
    queryKey: merchKeys.categoryOrder(category),
    queryFn: ({signal}) => manage<CategoryOrder>('collections/category-order', {query: {category}, signal}),
    enabled: !!category,
  });

/** Departments with their categories (`GET /site-api/manage/taxonomy/departments`, WP-18). */
export const collectionDepartmentsQuery = () =>
  queryOptions({
    queryKey: merchKeys.departments,
    queryFn: ({signal}) => manage<AdminDepartment[]>('taxonomy/departments', {signal}),
  });

/** The editor's picker: published and draft products by name or SKU (`GET /site-api/manage/products`, WP-17). */
export const collectionProductPickerQuery = (q: string) =>
  queryOptions({
    queryKey: merchKeys.productPicker(q),
    queryFn: ({signal}) =>
      manage<CursorPage<AdminProductRow>>('products', {query: {q: q || undefined, status: ['published', 'draft'], pageSize: 8, sort: 'name'}, signal}),
    staleTime: 30_000,
  });

// ─── Loaders (src/portal/routes.tsx) ─────────────────────────────────────────

export const loadCollections = (queryClient: QueryClient): Promise<void> =>
  queryClient.ensureQueryData(collectionsQuery()).then(() => undefined);

/** `id` is `new` for a new collection (nothing to load). */
export const loadCollection = (queryClient: QueryClient, id: string): Promise<void> =>
  id === 'new' ? Promise.resolve() : queryClient.ensureQueryData(collectionQuery(id)).then(() => undefined);

export const loadCategoryOrder = (queryClient: QueryClient): Promise<void> =>
  queryClient.ensureQueryData(collectionDepartmentsQuery()).then(() => undefined);

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Create (no id) or update (only the fields sent). */
export function saveCollection(id: string | undefined, input: Partial<AdminCollectionInput>): Promise<AdminCollection> {
  return id
    ? manage<AdminCollection>(`collections/${enc(id)}`, {method: 'PATCH', body: input})
    : manage<AdminCollection>('collections', {method: 'POST', body: input});
}

export const deleteCollection = (id: string) => manage<null>(`collections/${enc(id)}`, {method: 'DELETE'});

export const reorderCollections = (ids: string[]) => manage<AdminCollectionRow[]>('collections/order', {method: 'PATCH', body: {ids}});

export const saveCategoryOrder = (input: {category: string; productIds: string[]}) =>
  manage<CategoryOrder>('collections/product-order', {method: 'PATCH', body: input});

/** After a save: the detail answer is fresh; the list re-reads. */
export function collectionSaved(queryClient: QueryClient, c: AdminCollection) {
  queryClient.setQueryData(merchKeys.collection(c.id), c);
  void queryClient.invalidateQueries({queryKey: merchKeys.collections, exact: true});
}

export function collectionDeleted(queryClient: QueryClient, id: string) {
  queryClient.removeQueries({queryKey: merchKeys.collection(id)});
  void queryClient.invalidateQueries({queryKey: merchKeys.collections, exact: true});
}
