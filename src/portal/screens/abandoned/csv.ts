import type {AbandonedBagRow} from '../../../lib/types/admin/merchandising';
import {customerOf, STATUS_LABEL} from './format';

/* The selected bags as CSV, built in the browser from the loaded rows (VAREL `downloadCsv`). */

export const CSV_HEADER = ['Email', 'Customer', 'Status', 'Value', 'Pieces', 'Items', 'Started', 'Last activity', 'Reminder sent'];

/** One cell: a leading = + - @ is neutralised (CSV injection), quotes when it holds " , or a line break. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function abandonedCsv(rows: AbandonedBagRow[]): string {
  const lines: (string | number)[][] = [
    CSV_HEADER,
    ...rows.map(r => [
      r.email,
      customerOf(r),
      STATUS_LABEL[r.status],
      r.value.toFixed(2),
      r.itemCount,
      r.items.map(i => `${i.qty} × ${i.name}${i.meta ? ` (${i.meta})` : ''}`).join('; '),
      r.createdAt,
      r.lastActivity,
      r.reminderSentAt ?? '',
    ]),
  ];
  return lines.map(l => l.map(csvCell).join(',')).join('\n');
}

/** Saves the CSV as `varel-abandoned-bags-<n>.csv`. */
export function downloadCsv(rows: AbandonedBagRow[]) {
  const url = URL.createObjectURL(new Blob([abandonedCsv(rows)], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = `varel-abandoned-bags-${rows.length}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
