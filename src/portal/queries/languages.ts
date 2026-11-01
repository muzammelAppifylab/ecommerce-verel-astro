import type {QueryClient} from '@tanstack/react-query';

import type {RawSearch} from './search-params';

/** Settings · Languages (`/dashboard/settings/languages`). WP-25 owns this file (`/site-api/manage/translations`). */

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 1 ? n : undefined;
};

export const TRANSLATION_STATUSES = ['missing', 'stale', 'auto', 'manual'] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export interface TranslationsSearch {
  /** 'setup': languages, default language and provider; otherwise the translation workspace */
  view?: 'setup';
  entity?: string;
  locale?: string;
  status?: TranslationStatus;
  q?: string;
  page?: number;
}

export function validateTranslationsSearch(s: RawSearch): TranslationsSearch {
  return {
    view: s.view === 'setup' ? 'setup' : undefined,
    entity: text(s.entity),
    locale: text(s.locale),
    status: TRANSLATION_STATUSES.includes(s.status as TranslationStatus) ? (s.status as TranslationStatus) : undefined,
    q: text(s.q),
    page: int(s.page),
  };
}

/** WP-25 implements. */
export const loadLanguages = (_queryClient: QueryClient, _search: TranslationsSearch): Promise<void> => Promise.resolve();
