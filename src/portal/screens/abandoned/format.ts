import type {AbandonedBagRow, AbandonedBulkResult, AbandonedStatus} from '../../../lib/types/admin/merchandising';
import {pluralize} from '../../../lib/format';
import type {Tone} from '../../ui';
import type {AbandonedFilter, AbandonedSort} from '../../queries/abandoned';

/* Words and small pure helpers of the abandoned-bags screen (VAREL src/pages/admin/abandoned/AbandonedBags.tsx). */

export const HOURS = [1, 2, 4, 8, 12, 24, 48, 72].map(h => ({value: String(h), label: h === 1 ? 'After 1 hour' : `After ${h} hours`}));

/** The idle-time options, plus the current value when it is not one of them. */
export const hourOptions = (hours: number | undefined) =>
  hours !== undefined && !HOURS.some(h => h.value === String(hours)) ? [...HOURS, {value: String(hours), label: `After ${hours} hours`}] : HOURS;

export const STATUS_LABEL: Record<AbandonedStatus, string> = {
  active: 'Still shopping',
  abandoned: 'Due a reminder',
  reminded: 'Reminder sent',
  superseded: 'Older bag',
  dismissed: 'Dismissed',
  ordered: 'Ordered since',
};

export const STATUS_TONES: Record<AbandonedStatus, Tone> = {
  active: 'neutral',
  abandoned: 'warning',
  reminded: 'success',
  superseded: 'neutral',
  dismissed: 'neutral',
  ordered: 'success',
};

export const STATUS_HINT: Record<AbandonedStatus, string> = {
  active: 'Touched within the idle time, so not abandoned yet',
  abandoned: 'Idle long enough; the next run sends its reminder',
  reminded: 'One reminder has gone out for these pieces',
  superseded: 'The same shopper has a newer bag; only the newest gets a reminder',
  dismissed: 'No reminder until the shopper adds to the bag again',
  ordered: 'The shopper placed an order after filling this bag, so it is not abandoned',
};

export const FILTERS: {value: AbandonedFilter; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'abandoned', label: 'Due'},
  {value: 'reminded', label: 'Reminded'},
  {value: 'active', label: 'Still shopping'},
  {value: 'ordered', label: 'Ordered'},
  {value: 'superseded', label: 'Older'},
  {value: 'dismissed', label: 'Dismissed'},
];

/** VAREL sorted by clicking the Value / Last activity headers; here one Select. */
export const SORT_OPTIONS: {value: AbandonedSort; label: string}[] = [
  {value: '-lastActivity', label: 'Last activity (newest first)'},
  {value: 'lastActivity', label: 'Last activity (oldest first)'},
  {value: '-value', label: 'Value (highest first)'},
  {value: 'value', label: 'Value (lowest first)'},
];

export const SKIP_TEXT: Record<string, string> = {
  superseded: 'older bags',
  dismissed: 'dismissed',
  duplicate: 'same shopper',
  ordered: 'already ordered',
  'already-sent': 'just sent',
  'no-email': 'no email',
  empty: 'empty',
  missing: 'gone',
  error: 'failed',
};

/** "Just now", "12 minutes ago", "3 hours ago", "4 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? 'Just now' : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const DATE_TIME = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'});

/** "Mar 4, 2026, 2:05 PM" (VAREL admin `formatDateTime`). */
export const formatDateTime = (iso: string) => DATE_TIME.format(new Date(iso));

/** Who the bag belongs to, in the list. */
export const customerOf = (r: Pick<AbandonedBagRow, 'customerName' | 'userId'>) => r.customerName ?? (r.userId ? 'Customer account' : 'Guest');

/** Toast text for a bulk run: "3 reminders sent · 2 skipped (1 older bags, 1 already ordered)". */
export function bulkText(r: AbandonedBulkResult): string {
  const noun = r.action === 'remind' ? 'reminder' : 'bag';
  const verb = r.action === 'remind' ? 'sent' : r.action === 'dismiss' ? 'dismissed' : 'restored';
  const skipped = Object.entries(r.skipped).filter(([, n]) => n);
  const total = skipped.reduce((n, [, v]) => n + (v ?? 0), 0);
  const head = r.done ? `${pluralize(r.done, noun)} ${verb}` : `No ${noun}s ${verb}`;
  return total ? `${head} · ${total} skipped (${skipped.map(([k, n]) => `${n} ${SKIP_TEXT[k] ?? k}`).join(', ')})` : head;
}

/** Rows a bulk reminder may go to: never older, dismissed or ordered bags. */
export const remindableOf = (rows: AbandonedBagRow[]) => rows.filter(r => r.status !== 'superseded' && r.status !== 'dismissed' && r.status !== 'ordered');
