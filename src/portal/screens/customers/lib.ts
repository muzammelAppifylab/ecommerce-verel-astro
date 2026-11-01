/**
 * Small browser helpers shared by the customers and subscribers screens (both WP-20): client CSV of
 * selected rows, file downloads, the clipboard. Port of the helpers inside VAREL
 * `pages/admin/customers/actions.tsx`, `pages/admin/subscribers/Subscribers.tsx` and
 * `lib/api/privacy.ts` (`saveJson`).
 */

type Cell = string | number | boolean | null | undefined;

/** RFC 4180 escaping plus a leading ' on text a spreadsheet would run as a formula (same rule as the server's `csvCell`). */
export function csvCell(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV document, CRLF line ends. */
export const csvText = (header: string[], rows: Cell[][]) => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Hand the browser a file to save (an object URL, revoked a moment later). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const saveCsv = (text: string, filename: string) => saveBlob(new Blob([text], {type: 'text/csv;charset=utf-8'}), filename);

export const saveJson = (data: unknown, filename: string) =>
  saveBlob(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}), filename);

/** Today as `YYYY-MM-DD` (file names). */
export const today = () => new Date().toISOString().slice(0, 10);

export const CLIPBOARD_UNAVAILABLE = 'The clipboard is not available in this browser.';

/** Copy text; rejects when the clipboard is not available. */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error(CLIPBOARD_UNAVAILABLE);
  await navigator.clipboard.writeText(text);
}

/** "3 addresses", "1 subscriber". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 Mar 2026" from an ISO date ("—" for none). */
export const formatDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium'}).format(new Date(iso)) : '—';

/** "12 Mar 2026, 14:05". */
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(iso)) : '—';

/**
 * Run `fn` over `items`, at most `limit` at a time, and say which succeeded (VAREL `settle`):
 * bulk actions are one request per item, so one failure never hides the others.
 */
export async function settle<T>(items: readonly T[], fn: (item: T) => Promise<unknown>, key: (item: T) => string, limit = 5) {
  const done: T[] = [];
  const failed: {key: string; error: unknown}[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
        done.push(item);
      } catch (error) {
        failed.push({key: key(item), error});
      }
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return {done, failed};
}

export const errorText = (error: unknown, fallback = 'That did not work. Try again.') =>
  error instanceof Error && error.message ? error.message : fallback;
