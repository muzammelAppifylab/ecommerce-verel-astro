import {useCallback, useEffect, useRef, useState} from 'react';

import {photoUrl} from '../../../lib/format';
import {Icon} from '../../ui';
import {csvText} from './csv';

/*
 * Small building blocks of the inventory screen, ported from VAREL `src/pages/admin/products/ui.tsx`
 * (`Thumb`, `FilterToggles`, `useListSelection`, `downloadCsv`) and the shadcn `Checkbox` with its
 * indeterminate state (`RowCheck`). The kit has no multi-choice toggle group and no row selection on
 * `DataTable`, so they live here, styled with the kit's classes (`.segmented`, `.segment`).
 */

/** 3:4 product thumbnail with a quiet placeholder (VAREL `Thumb`). */
export function Thumb({src, alt = ''}: {src?: string | null; alt?: string}) {
  return (
    <span className="inv-thumb">
      {src ? <img src={photoUrl(src, 120)} alt={alt} loading="lazy" width={120} height={160} /> : <Icon name="package" size={14} />}
    </span>
  );
}

/** A native checkbox that can show "some selected" (VAREL used Radix's `indeterminate`). */
export function RowCheck({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="row-check"
      checked={checked}
      aria-checked={indeterminate && !checked ? 'mixed' : checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onChange={event => onChange(event.target.checked)}
    />
  );
}

/** Multi-select filter buttons; "All" clears the selection (VAREL `FilterToggles`, a shadcn ToggleGroup). */
export function FilterToggles<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly {value: T; label: string}[];
  value: readonly T[] | undefined;
  onChange: (next: T[] | undefined) => void;
}) {
  const selected = value ?? [];
  const toggle = (v: T) => {
    const picked = selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v];
    // Keep the options' own order so the URL reads the same however they were picked.
    onChange(picked.length ? options.map(o => o.value).filter(x => picked.includes(x)) : undefined);
  };
  return (
    <div className="segmented filter-toggles" role="group" aria-label={label}>
      <button type="button" className="segment" aria-pressed={selected.length === 0} onClick={() => selected.length && onChange(undefined)}>
        All
      </button>
      {options.map(o => (
        <button key={o.value} type="button" className="segment" aria-pressed={selected.includes(o.value)} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Row selection that belongs to the list as currently shown: any change of `listKey` (filters)
 * starts empty, so bulk actions never reach rows the user cannot see (VAREL `useListSelection`).
 */
export function useListSelection(listKey: string) {
  const [sel, setSel] = useState<{key: string; ids: ReadonlySet<string>}>({key: listKey, ids: NONE});
  const selected = sel.key === listKey ? sel.ids : NONE;
  const setSelected = useCallback((ids: ReadonlySet<string>) => setSel({key: listKey, ids}), [listKey]);
  const clear = useCallback(() => setSel({key: listKey, ids: NONE}), [listKey]);
  /** Drop ids (the ones an action finished) and keep the rest selected. */
  const drop = useCallback(
    (ids: string[]) => setSel(s => ({key: listKey, ids: new Set([...(s.key === listKey ? s.ids : NONE)].filter(x => !ids.includes(x)))})),
    [listKey]
  );
  return {selected, setSelected, clear, drop};
}

/** Client-side CSV download of the selected rows. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const url = URL.createObjectURL(new Blob([csvText(header, rows)], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
