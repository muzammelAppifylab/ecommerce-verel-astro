import {type QueryClient, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {AdminCategory, AdminDepartment} from '../../lib/types/admin/catalog';
import {manage} from '../api';

/**
 * Departments and categories (`/dashboard/catalog`). WP-18 owns this file (`/site-api/manage/taxonomy`).
 * Port of VAREL `src/lib/admin/products.ts` (departments part). The product editor's department and
 * category pickers read the same `departmentsQuery`.
 */

export const departmentsKey = ['admin', 'departments'] as const;

export const departmentsQuery = queryOptions({
  queryKey: departmentsKey,
  queryFn: ({signal}) => manage<AdminDepartment[]>('taxonomy/departments', {signal}),
  staleTime: 60_000,
});

export const loadDepartments = (queryClient: QueryClient): Promise<void> =>
  queryClient.ensureQueryData(departmentsQuery).then(() => undefined);

export type TaxonomyOp =
  | {kind: 'createDept'; name: string; position?: number}
  | {kind: 'updateDept'; id: string; name?: string; position?: number}
  | {kind: 'deleteDept'; id: string}
  | {kind: 'createCat'; deptId: string; name: string; position?: number}
  | {kind: 'updateCat'; id: string; name?: string; position?: number}
  | {kind: 'deleteCat'; id: string};

const enc = encodeURIComponent;

function runOp(op: TaxonomyOp): Promise<AdminDepartment | AdminCategory | null> {
  switch (op.kind) {
    case 'createDept':
      return manage<AdminDepartment>('taxonomy/departments', {method: 'POST', body: {name: op.name, position: op.position}});
    case 'updateDept':
      return manage<AdminDepartment>(`taxonomy/departments/${enc(op.id)}`, {method: 'PATCH', body: {name: op.name, position: op.position}});
    case 'deleteDept':
      return manage<null>(`taxonomy/departments/${enc(op.id)}`, {method: 'DELETE'});
    case 'createCat':
      return manage<AdminCategory>(`taxonomy/departments/${enc(op.deptId)}/categories`, {
        method: 'POST',
        body: {name: op.name, position: op.position},
      });
    case 'updateCat':
      return manage<AdminCategory>(`taxonomy/categories/${enc(op.id)}`, {method: 'PATCH', body: {name: op.name, position: op.position}});
    case 'deleteCat':
      return manage<null>(`taxonomy/categories/${enc(op.id)}`, {method: 'DELETE'});
  }
}

/**
 * One or more taxonomy writes, in order (a reorder renumbers several rows). The list and the
 * product editor's pickers refresh once the batch settles, also after a failure half way.
 */
export function useTaxonomyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ops: TaxonomyOp | TaxonomyOp[]) => {
      let last: AdminDepartment | AdminCategory | null = null;
      for (const op of Array.isArray(ops) ? ops : [ops]) last = await runOp(op);
      return last;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({queryKey: departmentsKey});
      void queryClient.invalidateQueries({queryKey: ['admin', 'products']});
    },
  });
}
