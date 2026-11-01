import {infiniteQueryOptions, queryOptions, useMutation, useQueryClient, type QueryClient} from '@tanstack/react-query';
import {useCallback, useRef, useState} from 'react';

import type {StoreSettingsInput} from '../../lib/types/admin/store';
import type {
  BackfillProgress,
  EntityTranslations,
  SettingsWithI18n,
  TranslateMissingResult,
  TranslationList,
  TranslationsStatus,
  TranslationTarget,
} from '../../lib/types/admin/translations';
import {manage} from '../api';
import type {RawSearch} from './search-params';

/**
 * Settings · Languages (`/dashboard/settings/languages`). WP-25 owns this file (`/site-api/manage/translations`).
 * Port of VAREL `src/lib/admin/translations.ts` (queries, mutations, the "translate everything" loop) and
 * `src/pages/admin/translations/search.ts`. VAREL's normalisers are gone: the server answers the types exactly.
 * The list is keyset-paged (`useInfiniteQuery` + `LoadMore`), so the search has no `page`.
 *
 * Languages themselves (add, remove, default, provider, automatic translation) are store settings:
 * `GET / PATCH /site-api/manage/settings` (WP-23).
 */

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const TRANSLATION_STATUSES = ['missing', 'stale', 'auto', 'manual'] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export interface TranslationsSearch {
  /** 'setup': languages, default language and provider; otherwise the translation workspace */
  view?: 'setup';
  entity?: string;
  locale?: string;
  status?: TranslationStatus;
  q?: string;
}

export function validateTranslationsSearch(s: RawSearch): TranslationsSearch {
  return {
    view: s.view === 'setup' ? 'setup' : undefined,
    entity: text(s.entity),
    locale: text(s.locale),
    status: TRANSLATION_STATUSES.includes(s.status as TranslationStatus) ? (s.status as TranslationStatus) : undefined,
    q: text(s.q),
  };
}

/** VAREL `PAGE_SIZE`. */
export const TRANSLATIONS_PAGE_SIZE = 25;

/** PUT body (the server's shape; F3's `EntityTranslationsInput` differs: request R1). */
export interface TranslationSaveInput extends Required<TranslationTarget> {
  value: string;
}

/** POST /retranslate answers the record plus what happened (request R1). */
export type RetranslateResult = EntityTranslations & {result: {translated: number; failed: number; skipped: number}};

export interface TranslationListParams {
  entity?: string;
  locale?: string;
  status?: TranslationStatus | '';
  q?: string;
}

/* ── Keys ──────────────────────────────────────────────────────────────── */

export const translationKeys = {
  all: ['admin', 'translations'] as const,
  status: ['admin', 'translations', 'status'] as const,
  list: (p: TranslationListParams) => ['admin', 'translations', 'list', p] as const,
  entity: (entity: string, id: string) => ['admin', 'translations', 'entity', entity, id] as const,
};

/** Store settings, read by the Setup tab (WP-23 serves it; share this key with its screens: request R6). */
export const LANGUAGE_SETTINGS_KEY = ['admin', 'settings'] as const;

/* ── Queries ───────────────────────────────────────────────────────────── */

export const translationsStatusQuery = (poll = false) =>
  queryOptions({
    queryKey: translationKeys.status,
    queryFn: ({signal}) => manage<TranslationsStatus>('translations/status', {signal}),
    refetchInterval: poll ? 4000 : false,
  });

export const translationsListQuery = (p: TranslationListParams) =>
  infiniteQueryOptions({
    queryKey: translationKeys.list(p),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      manage<TranslationList>('translations', {
        query: {entity: p.entity, locale: p.locale, status: p.status, q: p.q, cursor: pageParam, pageSize: TRANSLATIONS_PAGE_SIZE},
        signal,
      }),
    getNextPageParam: last => last.nextCursor ?? undefined,
  });

export const entityTranslationsQuery = (entity: string, id: string) =>
  queryOptions({
    queryKey: translationKeys.entity(entity, id),
    queryFn: ({signal}) => manage<EntityTranslations>(`translations/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, {signal}),
    enabled: !!id,
  });

export const languageSettingsQuery = queryOptions({
  queryKey: LANGUAGE_SETTINGS_KEY,
  queryFn: ({signal}) => manage<SettingsWithI18n>('settings', {signal}),
});

/** The list parameters the workspace shows for a search (the selected language, or the first target). */
export function translationListParams(status: TranslationsStatus, search: TranslationsSearch): TranslationListParams | null {
  const targets = status.locales.filter(l => l !== status.defaultLocale);
  const locale = search.locale && targets.includes(search.locale) ? search.locale : targets[0];
  if (!locale) return null;
  return {entity: search.entity, locale, status: search.status, q: search.q};
}

/** Route loader: coverage first, then the workspace's first page (or the settings for the Setup tab). */
export async function loadLanguages(queryClient: QueryClient, search: TranslationsSearch): Promise<void> {
  if (search.view === 'setup') {
    await queryClient.ensureQueryData(languageSettingsQuery);
    return;
  }
  const status = await queryClient.ensureQueryData(translationsStatusQuery());
  const params = translationListParams(status, search);
  if (params) await queryClient.prefetchInfiniteQuery(translationsListQuery(params));
}

/* ── Mutations ─────────────────────────────────────────────────────────── */

const entityPath = (t: TranslationTarget) => `translations/${encodeURIComponent(t.entity)}/${encodeURIComponent(t.entityId)}`;

function useTranslationMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({queryKey: translationKeys.all}),
  });
}

/** Save a manual translation. Manual translations are never overwritten by auto-translation. */
export const useSaveTranslation = () =>
  useTranslationMutation((v: TranslationSaveInput) =>
    manage<EntityTranslations>(entityPath(v), {method: 'PUT', body: {field: v.field, locale: v.locale, value: v.value}})
  );

/** Machine-translate again (one field, one locale, or the whole record). Replaces manual edits for the targets. */
export const useRetranslate = () =>
  useTranslationMutation((v: TranslationTarget) => manage<RetranslateResult>('translations/retranslate', {method: 'POST', body: v}));

/** Drop the manual override and go back to the automatic translation. */
export const useRevertTranslation = () =>
  useTranslationMutation((v: TranslationTarget) =>
    manage<EntityTranslations>(entityPath(v), {method: 'DELETE', query: {field: v.field, locale: v.locale}})
  );

/** Translate one bounded batch of missing or stale automatic translations. */
export const useTranslateMissing = () =>
  useTranslationMutation((v: {locale?: string; entity?: string}) =>
    manage<TranslateMissingResult>('translations/translate-missing', {method: 'POST', body: v})
  );

/** PATCH store settings (languages, default, provider, automatic translation), then refresh coverage. */
export function useUpdateLanguageSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: StoreSettingsInput) => manage<SettingsWithI18n>('settings', {method: 'PATCH', body: v}),
    onSuccess: data => qc.setQueryData(LANGUAGE_SETTINGS_KEY, data),
    onSettled: () => {
      void qc.invalidateQueries({queryKey: LANGUAGE_SETTINGS_KEY});
      void qc.invalidateQueries({queryKey: translationKeys.all});
    },
  });
}

/* ── Backfill with progress ────────────────────────────────────────────── */

const IDLE: BackfillProgress = {running: false, done: 0, total: null, failed: 0, error: null, finished: false};

/** Calls translate-missing in batches until nothing is left (or a batch makes no progress), reporting progress. */
export function useTranslateAllMissing() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<BackfillProgress>(IDLE);
  const stop = useRef(false);

  const run = useCallback(
    async (scope: {locale?: string; entity?: string} = {}) => {
      stop.current = false;
      setProgress({...IDLE, running: true});
      let done = 0;
      let failed = 0;
      try {
        for (let i = 0; i < 200 && !stop.current; i++) {
          const r = await manage<TranslateMissingResult>('translations/translate-missing', {method: 'POST', body: scope});
          const translated = r.translated ?? 0;
          const remaining = r.remaining ?? 0;
          done += translated;
          failed += r.failed ?? 0;
          setProgress(s => ({...s, done, failed, total: done + remaining}));
          void qc.invalidateQueries({queryKey: translationKeys.status});
          if (remaining === 0 || translated === 0) break;
        }
        setProgress(s => ({...s, running: false, finished: true}));
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : '';
        setProgress(s => ({...s, running: false, finished: true, error: message ? `Translation stopped: ${message}` : 'Translation stopped'}));
      } finally {
        void qc.invalidateQueries({queryKey: translationKeys.all});
      }
    },
    [qc]
  );

  return {
    progress,
    run,
    cancel: () => {
      stop.current = true;
    },
    reset: () => setProgress(IDLE),
  };
}
