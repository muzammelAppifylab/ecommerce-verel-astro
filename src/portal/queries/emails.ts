import type {QueryClient} from '@tanstack/react-query';

import type {RawSearch} from './search-params';

/** Settings · Emails (`/dashboard/settings/emails`). WP-22 owns this file (`/site-api/manage/emails`). */

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 1 ? n : undefined;
};

export type EmailsTab = 'templates' | 'messages' | 'delivery';
export const EMAIL_STATUSES = ['stored', 'sent', 'queued', 'failed', 'skipped'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export interface EmailsSearch {
  tab?: EmailsTab;
  /** templates: the open template key */
  key?: string;
  /** messages filters */
  status?: EmailStatus;
  template?: string;
  q?: string;
  page?: number;
  /** messages: the open message */
  id?: string;
}

export function validateEmailsSearch(s: RawSearch): EmailsSearch {
  const status = EMAIL_STATUSES.includes(s.status as EmailStatus) ? (s.status as EmailStatus) : undefined;
  return {
    tab: s.tab === 'messages' || s.tab === 'delivery' ? s.tab : undefined,
    key: text(s.key),
    status,
    template: text(s.template),
    q: text(s.q),
    page: int(s.page),
    id: text(s.id),
  };
}

/** WP-22 implements. */
export const loadEmails = (_queryClient: QueryClient, _search: EmailsSearch): Promise<void> => Promise.resolve();
