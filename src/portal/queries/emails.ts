import {infiniteQueryOptions, keepPreviousData, queryOptions, type QueryClient} from '@tanstack/react-query';

import type {CursorPage} from '../../lib/types/admin/common';
import type {AdminEmailMessage, AdminEmailTemplate, EmailPreview, EmailVars} from '../../lib/types/admin/emails';
import type {AdminEmailMessageFull, EmailDelivery, EmailDeliveryInput, EmailMessageCounts} from '../../server/lib/email/types';
import {manage} from '../api';
import type {RawSearch} from './search-params';

/**
 * Settings · Emails (`/dashboard/settings/emails`). WP-22 owns this file: port of VAREL src/lib/admin/emails.ts
 * against `/site-api/manage/emails` (src/server/routes/admin/emails.ts). Keys live under `['manage', 'emails', …]`.
 */


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
  /** VAREL's page number: kept for old links, ignored (the log is keyset-paged). */
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

// ─── Reads ──────────────────────────────────────────────────────────────────

export interface EmailMessageFilters {
  status?: EmailStatus;
  template?: string;
  q?: string;
}

export const emailKeys = {
  all: ['manage', 'emails'] as const,
  templates: ['manage', 'emails', 'templates'] as const,
  messages: ['manage', 'emails', 'messages'] as const,
  messageList: (f: EmailMessageFilters) => ['manage', 'emails', 'messages', 'list', f] as const,
  message: (id: string) => ['manage', 'emails', 'messages', 'detail', id] as const,
  counts: ['manage', 'emails', 'messages', 'counts'] as const,
  delivery: ['manage', 'emails', 'delivery'] as const,
  preview: (key: string, draft: unknown) => ['manage', 'emails', 'preview', key, draft] as const,
};

export const EMAILS_PAGE_SIZE = 25;

export const emailTemplatesQuery = queryOptions({
  queryKey: emailKeys.templates,
  queryFn: ({signal}) => manage<AdminEmailTemplate[]>('emails/templates', {signal}),
});

export const emailDeliveryQuery = queryOptions({
  queryKey: emailKeys.delivery,
  queryFn: ({signal}) => manage<EmailDelivery>('emails/delivery', {signal}),
});

export const emailCountsQuery = queryOptions({
  queryKey: emailKeys.counts,
  queryFn: ({signal}) => manage<EmailMessageCounts>('emails/messages/counts', {signal}),
  staleTime: 30_000,
});

export const emailMessagesQuery = (f: EmailMessageFilters) =>
  infiniteQueryOptions({
    queryKey: emailKeys.messageList({status: f.status, template: f.template, q: f.q}),
    queryFn: ({signal, pageParam}) =>
      manage<CursorPage<AdminEmailMessage>>('emails/messages', {
        signal,
        query: {status: f.status, template: f.template, q: f.q, cursor: pageParam, pageSize: EMAILS_PAGE_SIZE},
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const emailMessageQuery = (id: string) =>
  queryOptions({
    queryKey: emailKeys.message(id),
    queryFn: ({signal}) => manage<AdminEmailMessageFull>(`emails/messages/${encodeURIComponent(id)}`, {signal}),
  });

export interface EmailPreviewDraft {
  subject: string;
  body: string;
  vars: EmailVars;
}

export const emailPreviewQuery = (key: string, draft: EmailPreviewDraft | null) =>
  queryOptions({
    queryKey: emailKeys.preview(key, draft),
    queryFn: ({signal}) =>
      manage<EmailPreview>(`emails/templates/${encodeURIComponent(key)}/preview`, {method: 'POST', body: draft, signal}),
    enabled: !!key && !!draft,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

/** The route loader: templates and delivery always; the log and its counts on the messages tab; the open message. */
export const loadEmails = async (queryClient: QueryClient, search: EmailsSearch): Promise<void> => {
  const reads: Promise<unknown>[] = [queryClient.ensureQueryData(emailTemplatesQuery), queryClient.ensureQueryData(emailDeliveryQuery)];
  if (search.tab === 'messages') {
    reads.push(
      queryClient.ensureInfiniteQueryData(emailMessagesQuery({status: search.status, template: search.template, q: search.q})),
      queryClient.ensureQueryData(emailCountsQuery)
    );
    if (search.id) reads.push(queryClient.ensureQueryData(emailMessageQuery(search.id)));
  }
  await Promise.all(reads.map(r => r.catch(() => undefined)));
};

// ─── Writes ─────────────────────────────────────────────────────────────────

const replaceTemplate = (qc: QueryClient, t: AdminEmailTemplate) =>
  qc.setQueryData<AdminEmailTemplate[]>(emailKeys.templates, all => all?.map(x => (x.key === t.key ? t : x)));

export async function updateEmailTemplate(qc: QueryClient, key: string, input: {subject?: string; body?: string; enabled?: boolean}) {
  const t = await manage<AdminEmailTemplate>(`emails/templates/${encodeURIComponent(key)}`, {method: 'PATCH', body: input});
  replaceTemplate(qc, t);
  return t;
}

export async function resetEmailTemplate(qc: QueryClient, key: string) {
  const t = await manage<AdminEmailTemplate>(`emails/templates/${encodeURIComponent(key)}/reset`, {method: 'POST'});
  replaceTemplate(qc, t);
  return t;
}

const afterSend = (qc: QueryClient) => {
  void qc.invalidateQueries({queryKey: emailKeys.messages});
  void qc.invalidateQueries({queryKey: emailKeys.templates});
};

export async function sendTestEmail(qc: QueryClient, key: string, input: {to?: string; subject?: string; body?: string; vars?: EmailVars}) {
  try {
    return await manage<AdminEmailMessageFull>(`emails/templates/${encodeURIComponent(key)}/test`, {method: 'POST', body: input});
  } finally {
    afterSend(qc);
  }
}

export async function resendEmail(qc: QueryClient, id: string) {
  try {
    return await manage<AdminEmailMessageFull>(`emails/messages/${encodeURIComponent(id)}/resend`, {method: 'POST'});
  } finally {
    afterSend(qc);
  }
}

export async function saveEmailDelivery(qc: QueryClient, input: EmailDeliveryInput) {
  const d = await manage<EmailDelivery>('emails/delivery', {method: 'PATCH', body: input});
  qc.setQueryData(emailKeys.delivery, d);
  // Settings · General (WP-23) shows the same columns.
  void qc.invalidateQueries({queryKey: ['manage', 'settings']});
  return d;
}
