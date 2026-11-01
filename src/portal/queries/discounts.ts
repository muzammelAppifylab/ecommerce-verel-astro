import {
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import type {AdminDepartment} from '../../lib/types/admin/catalog';
import type {CursorPage} from '../../lib/types/common';
import type {
  AdminDiscount,
  AdminDiscountCode,
  AdminDiscountInput,
  AdminDiscountReport,
  DeleteResult,
  DiscountBulkResult,
  DiscountPreview,
  GenerateCodesInput,
} from '../../lib/types/admin/promotions';
import {siteFetch} from '../../platform/browser';
import {ApiError, manage, toQueryString} from '../api';
import type {RawSearch} from './search-params';

/**
 * Discounts (`/dashboard/discounts`, `/new`, `/$id`). WP-21 owns this file (`/site-api/manage/discounts`).
 * Port of VAREL `src/lib/admin/promotions.ts` (hooks → `queryOptions` the loaders warm + mutation hooks) and the
 * search validators of `src/pages/admin/discounts/helpers.ts`.
 */

export const DISCOUNT_STATUSES = ['active', 'scheduled', 'expired', 'inactive', 'used_up'] as const;
export type DiscountStatus = (typeof DISCOUNT_STATUSES)[number];
export type DiscountMethod = 'code' | 'automatic';

export interface DiscountsSearch {
  method?: DiscountMethod;
  status?: DiscountStatus[];
  q?: string;
}

export function validateDiscountsSearch(raw: RawSearch): DiscountsSearch {
  const method = raw.method === 'code' || raw.method === 'automatic' ? raw.method : undefined;
  const list = typeof raw.status === 'string' ? raw.status.split(',') : Array.isArray(raw.status) ? raw.status.map(String) : [];
  const status = DISCOUNT_STATUSES.filter(s => list.includes(s));
  const q = typeof raw.q === 'string' && raw.q.trim() ? raw.q.trim().slice(0, 60) : undefined;
  return {method, status: status.length ? status : undefined, q};
}

export type DiscountEditorTab = 'settings' | 'codes' | 'report';
export interface DiscountEditSearch {
  tab?: Exclude<DiscountEditorTab, 'settings'>;
}

export function validateDiscountEditSearch(raw: RawSearch): DiscountEditSearch {
  return {tab: raw.tab === 'codes' || raw.tab === 'report' ? raw.tab : undefined};
}

export const DISCOUNT_PRESETS = ['order', 'products', 'bxgy', 'shipping'] as const;
export type DiscountPreset = (typeof DISCOUNT_PRESETS)[number];

export interface NewDiscountSearch {
  type?: DiscountPreset;
  /** Duplicate: id of the discount to copy. */
  from?: string;
}

export function validateNewDiscountSearch(raw: RawSearch): NewDiscountSearch {
  const type = DISCOUNT_PRESETS.find(p => p === raw.type);
  const from = typeof raw.from === 'string' && raw.from ? raw.from.slice(0, 80) : undefined;
  return {type, from};
}

// ─── Reads ────────────────────────────────────────────────────────────────

const BASE = 'discounts';
const enc = encodeURIComponent;

export interface DiscountCodeFilter {
  q?: string;
  used?: boolean;
}

export const discountKeys = {
  all: ['manage', 'discounts'] as const,
  lists: ['manage', 'discounts', 'list'] as const,
  list: (q: string) => ['manage', 'discounts', 'list', q] as const,
  one: (id: string) => ['manage', 'discounts', 'one', id] as const,
  codes: (id: string, p: DiscountCodeFilter) => ['manage', 'discounts', 'codes', id, p] as const,
  report: (id: string) => ['manage', 'discounts', 'report', id] as const,
  preview: (q: string) => ['manage', 'discounts', 'preview', q] as const,
  names: (kind: 'product' | 'customer', ids: string) => ['manage', 'discounts', 'names', kind, ids] as const,
  taxonomy: ['manage', 'discounts', 'taxonomy'] as const,
};

/** Every discount (newest 100): the list screen filters it client side, so the tabs switch instantly. */
export const discountsQuery = () =>
  queryOptions({
    queryKey: discountKeys.list(''),
    queryFn: ({signal}) => manage<AdminDiscount[]>(BASE, {signal}),
  });

/** The server match for `q`: it also covers unique codes, which the list rows don't carry. */
export const discountSearchQuery = (q: string) =>
  queryOptions({
    queryKey: discountKeys.list(q),
    queryFn: ({signal}) => manage<AdminDiscount[]>(BASE, {signal, query: {q}}),
    placeholderData: keepPreviousData,
  });

export const discountQuery = (id: string) =>
  queryOptions({
    queryKey: discountKeys.one(id),
    queryFn: ({signal}) => manage<AdminDiscount>(`${BASE}/${enc(id)}`, {signal}),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

/** The unique codes of a discount, keyset-paged (`LoadMore`). */
export const discountCodesQuery = (id: string, p: DiscountCodeFilter) =>
  infiniteQueryOptions({
    queryKey: discountKeys.codes(id, p),
    initialPageParam: undefined as string | undefined,
    queryFn: ({signal, pageParam}) =>
      manage<CursorPage<AdminDiscountCode>>(`${BASE}/${enc(id)}/codes`, {signal, query: {q: p.q, used: p.used, cursor: pageParam}}),
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const discountReportQuery = (id: string) =>
  queryOptions({
    queryKey: discountKeys.report(id),
    queryFn: ({signal}) => manage<AdminDiscountReport>(`${BASE}/${enc(id)}/report`, {signal}),
  });

/** Products, categories, departments and (with a query) customers for the pickers. */
export const discountPreviewQuery = (q: string) =>
  queryOptions({
    queryKey: discountKeys.preview(q),
    queryFn: ({signal}) => manage<DiscountPreview>(`${BASE}/preview`, {signal, query: {q}}),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/** Names of chosen products or customers by id (one request for every chip). `ids`: sorted, comma-joined. */
export const discountNamesQuery = (kind: 'product' | 'customer', ids: string) =>
  queryOptions({
    queryKey: discountKeys.names(kind, ids),
    queryFn: ({signal}) => manage<{id: string; name: string}[]>(`${BASE}/names`, {signal, query: {kind, ids}}),
    staleTime: 60_000,
    enabled: ids.length > 0,
  });

/**
 * Departments with their categories, for the category / department pickers and their chips (VAREL
 * `useAdminDepartments`). Reads WP-18's `/manage/taxonomy/departments` (open to any staff); until that route
 * answers, the picker's own `/discounts/preview` lists stand in (≤ 20 each, no product counts: `-1`).
 */
export const discountTaxonomyQuery = () =>
  queryOptions({
    queryKey: discountKeys.taxonomy,
    queryFn: async ({signal}): Promise<AdminDepartment[]> => {
      try {
        const depts = await manage<AdminDepartment[]>('taxonomy/departments', {signal});
        if (Array.isArray(depts)) return depts;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status < 404) throw error;
      }
      const preview = await manage<DiscountPreview>(`${BASE}/preview`, {signal});
      return preview.departments.map((d, position) => ({
        id: d.id,
        name: d.name,
        slug: '',
        position,
        productCount: -1,
        categories: preview.categories
          .filter(c => (c.department ?? c.dept) === d.name)
          .map((c, i) => ({id: c.id, name: c.name, slug: '', position: i, productCount: -1})),
      }));
    },
    staleTime: 60_000,
  });

// ─── Loaders ──────────────────────────────────────────────────────────────

export const loadDiscounts = async (queryClient: QueryClient, search: DiscountsSearch): Promise<void> => {
  await Promise.all([
    queryClient.ensureQueryData(discountsQuery()),
    search.q ? queryClient.ensureQueryData(discountSearchQuery(search.q)) : undefined,
  ]);
};

/** The copied discount when `from` is set, and the taxonomy for the pickers. */
export const loadNewDiscount = async (queryClient: QueryClient, search: NewDiscountSearch): Promise<void> => {
  await Promise.all([
    queryClient.ensureQueryData(discountTaxonomyQuery()),
    search.from ? queryClient.ensureQueryData(discountQuery(search.from)) : undefined,
  ]);
};

export const loadDiscount = async (queryClient: QueryClient, id: string): Promise<void> => {
  await Promise.all([queryClient.ensureQueryData(discountQuery(id)), queryClient.ensureQueryData(discountTaxonomyQuery())]);
};

// ─── Writes ───────────────────────────────────────────────────────────────

export function useCreateDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminDiscountInput) => manage<AdminDiscount>(BASE, {method: 'POST', body}),
    onSuccess: d => {
      qc.setQueryData(discountKeys.one(d.id), d);
      return qc.invalidateQueries({queryKey: discountKeys.lists});
    },
  });
}

export function useUpdateDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({id, ...body}: Partial<AdminDiscountInput> & {id: string}) =>
      manage<AdminDiscount>(`${BASE}/${enc(id)}`, {method: 'PATCH', body}),
    onMutate: async ({id, ...patch}) => {
      // Optimistic for list switches: patch every cached list containing this discount.
      await qc.cancelQueries({queryKey: discountKeys.lists});
      const prev = qc.getQueriesData<AdminDiscount[]>({queryKey: discountKeys.lists});
      for (const [key, rows] of prev) if (rows) qc.setQueryData(key, rows.map(d => (d.id === id ? {...d, ...patch} : d)));
      return {prev};
    },
    onError: (_e, _v, ctx) => {
      for (const [key, rows] of ctx?.prev ?? []) qc.setQueryData(key, rows);
    },
    onSuccess: d => qc.setQueryData(discountKeys.one(d.id), d),
    onSettled: () => qc.invalidateQueries({queryKey: discountKeys.all}),
  });
}

/** DELETE answers 204 (no body) or 200 `{deactivated, discount}`. */
async function deleteDiscount(id: string): Promise<DeleteResult> {
  const res = await siteFetch(`/site-api/manage/${BASE}/${enc(id)}`, {method: 'DELETE'});
  if (res.status === 204) return undefined;
  const body = (await res.json().catch(() => null)) as (DeleteResult & {message?: string; fields?: Record<string, string>}) | null;
  if (!res.ok) throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status, body?.fields);
  return body ?? undefined;
}

export function useDeleteDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDiscount(id),
    // Don't refetch the deleted discount itself (404); a deactivated one is refreshed.
    onSuccess: (r, id) => {
      if (r?.deactivated) {
        if (r.discount) qc.setQueryData(discountKeys.one(id), r.discount);
        return;
      }
      qc.removeQueries({queryKey: discountKeys.one(id), exact: true});
    },
    onSettled: () => qc.invalidateQueries({queryKey: discountKeys.lists}),
  });
}

/** Activate, deactivate or delete several discounts (no bulk endpoint: parallel calls, one refresh). */
export function useBulkDiscounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({discounts, action}: {discounts: AdminDiscount[]; action: 'activate' | 'deactivate' | 'delete'}) => {
      const settled = await Promise.allSettled(
        discounts.map(d =>
          action === 'delete'
            ? deleteDiscount(d.id)
            : manage<AdminDiscount>(`${BASE}/${enc(d.id)}`, {method: 'PATCH', body: {active: action === 'activate'}})
        )
      );
      const r: DiscountBulkResult = {done: [], deactivated: [], failed: []};
      settled.forEach((s, i) => {
        const d = discounts[i]!;
        if (s.status === 'rejected') r.failed.push({discount: d, error: s.reason});
        else if (action === 'delete' && (s.value as DeleteResult)?.deactivated) r.deactivated.push(d);
        else r.done.push(d);
      });
      return r;
    },
    onSettled: () => qc.invalidateQueries({queryKey: discountKeys.all}),
  });
}

export function useGenerateCodes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateCodesInput) => manage<{created: number}>(`${BASE}/${enc(id)}/codes`, {method: 'POST', body}),
    onSettled: () => qc.invalidateQueries({queryKey: discountKeys.all}),
  });
}

export function useDeleteUnusedCodes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => manage<{deleted: number}>(`${BASE}/${enc(id)}/codes`, {method: 'DELETE'}),
    onSettled: () => qc.invalidateQueries({queryKey: discountKeys.all}),
  });
}

/**
 * Download the codes CSV through `siteFetch` (a plain link would not carry the session in the Preview, nor
 * refresh an expired one): the file becomes a blob and a temporary `<a download>` saves it.
 */
export async function downloadCodesCsv(id: string, p: DiscountCodeFilter = {}): Promise<void> {
  const res = await siteFetch(`/site-api/manage/${BASE}/${enc(id)}/codes.csv${toQueryString({q: p.q, used: p.used})}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {message?: string} | null;
    throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `discount-${id}-codes.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A short message for a failed call (VAREL `problem`): the first field error, else the message. */
export function discountProblem(error: unknown): string {
  if (error instanceof ApiError) return Object.values(error.fields)[0] ?? error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
