/* Small building blocks of the products list (VAREL `src/pages/admin/products/ui.tsx`): multi-select filter
   toggles, the 3:4 thumbnail, the row checkbox (with an indeterminate state), list selection and the CSV export.
   `AdminSelect` → kit `Select`, `ErrorState` → kit `ErrorNote` + retry; `Swatch` is WP-18's. */
import {useCallback, useEffect, useRef, useState} from 'react';

import {photoUrl} from '../../../lib/format';
import {Icon} from '../../ui';

/** Segmented multi-select filter: "All" clears; picks keep the list's order. */
export function FilterToggles<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly {value: T; label: string}[];
  value: T[] | undefined;
  onChange: (next: T[] | undefined) => void;
}) {
  const selected = value ?? [];
  const toggle = (v: T) => {
    const next = selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v];
    onChange(next.length ? options.map(o => o.value).filter(x => next.includes(x)) : undefined);
  };
  return (
    <div className="filter-toggles" role="group" aria-label={label}>
      <button type="button" className="filter-toggle" aria-pressed={selected.length === 0} onClick={() => onChange(undefined)}>
        All
      </button>
      {options.map(o => (
        <button key={o.value} type="button" className="filter-toggle" aria-pressed={selected.includes(o.value)} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 3:4 product thumbnail with a quiet placeholder; the photo is cropped to fill it, never stretched. */
export function Thumb({src, alt = ''}: {src?: string | null; alt?: string}) {
  return (
    <span className="product-thumb">
      {src ? <img src={photoUrl(src, 120)} alt={alt} loading="lazy" width={120} height={160} /> : <Icon name="package" size={14} />}
    </span>
  );
}

/** A row (or "select all") checkbox; `mixed` shows the indeterminate state. */
export function RowCheck({label, checked, mixed, onChange, disabled}: {label: string; checked: boolean; mixed?: boolean; onChange: (checked: boolean) => void; disabled?: boolean}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(mixed) && !checked;
  }, [mixed, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="row-check"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
    />
  );
}

const NONE: ReadonlySet<string> = new Set();

/** Row selection that belongs to the list as currently shown: any change of `listKey` (filters, sort) starts
 *  empty, so bulk actions never reach rows the user cannot see. Loading more keeps it. */
export function useListSelection(listKey: string) {
  const [sel, setSel] = useState<{key: string; ids: ReadonlySet<string>}>({key: listKey, ids: NONE});
  const selected = sel.key === listKey ? sel.ids : NONE;
  const setSelected = useCallback((ids: ReadonlySet<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSel({key: listKey, ids: NONE}), [listKey]);
  /** Drop ids (e.g. the ones an action finished) and keep the rest selected. */
  const drop = useCallback(
    (ids: string[]) => setSel(s => ({key: listKey, ids: new Set([...(s.key === listKey ? s.ids : NONE)].filter(x => !ids.includes(x)))})),
    [listKey]
  );
  return {selected, setSelected, clear, drop};
}

/** One CSV cell: RFC 4180 quoting, and a leading `'` on text a spreadsheet would run as a formula. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvText = (header: string[], rows: (string | number | null)[][]) => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');

/** Client-side CSV download for the selected rows. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const url = URL.createObjectURL(new Blob([csvText(header, rows)], {type: 'text/csv'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: filename});
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
