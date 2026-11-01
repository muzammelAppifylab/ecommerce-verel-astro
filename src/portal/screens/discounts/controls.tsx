/* Form controls for the promotion editor (port of VAREL src/pages/admin/discounts/controls.tsx): affixed number
   input, date-time picker, the searchable multi-pickers for scope targets and customers, and the list filters.
   Segmented choices and choice cards are the kit's `SegmentedControl` / `RadioCards`. No inline styles (CSP):
   every look is a class in ./screen.css. */
import {useQuery} from '@tanstack/react-query';
import {useEffect, useMemo, useRef, useState} from 'react';
import {DayPicker} from 'react-day-picker';

import {photoUrl} from '../../../lib/format';
import type {PreviewTarget} from '../../../lib/types/admin/promotions';
import {discountNamesQuery, discountPreviewQuery, discountTaxonomyQuery} from '../../queries/discounts';
import {Icon, Popover, Skeleton} from '../../ui';
import {formatWhen} from './helpers';

/** `aria-describedby` for a control inside a kit `Field` (its error, else its hint). */
export const describedBy = (id: string, error?: string, hint?: unknown) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

/* ── Number input with prefix/suffix ───────────────────────────────────── */

export function NumberInput({
  id,
  value,
  onChange,
  prefix,
  suffix,
  invalid,
  describedBy: describedById,
  placeholder,
  decimals = true,
  negative = false,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  decimals?: boolean;
  /** Allow a leading minus sign. */
  negative?: boolean;
  disabled?: boolean;
}) {
  return (
    <span className="affix-input" data-invalid={invalid ? '' : undefined} data-disabled={disabled ? '' : undefined}>
      {prefix && (
        <span className="affix" aria-hidden="true">
          {prefix}
        </span>
      )}
      <input
        id={id}
        inputMode={decimals ? 'decimal' : 'numeric'}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onChange={e => {
          const raw = e.target.value;
          const digits = raw.replace(decimals ? /[^\d.]/g : /\D/g, '');
          onChange(negative && raw.trim().startsWith('-') ? `-${digits}` : digits);
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
      />
      {suffix && (
        <span className="affix" aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  );
}

/* ── Date-time picker ──────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');

export function DateTimeField({
  id,
  value,
  onChange,
  empty,
  invalid,
  describedBy: describedById,
  defaultTime = '09:00',
  disabled,
}: {
  id: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Text when no date is set, e.g. "Starts now". */
  empty: string;
  invalid?: boolean;
  describedBy?: string;
  defaultTime?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const date = value ? new Date(value) : undefined;
  const time = date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : defaultTime;

  const emit = (day: Date | undefined, t: string) => {
    if (!day) return onChange(null);
    const [h, m] = t.split(':').map(Number);
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0);
    onChange(d.toISOString());
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="filter-trigger datetime-trigger"
        data-empty={value ? undefined : ''}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}>
        <Icon name="calendar" size={16} />
        <span>{value ? formatWhen(value) : empty}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label="Pick a date and time" className="datetime-panel">
        <DayPicker mode="single" selected={date} defaultMonth={date} onSelect={d => emit(d, time)} weekStartsOn={1} />
        <div className="datetime-time">
          <label htmlFor={`${id}-time`}>Time</label>
          <input id={`${id}-time`} type="time" value={time} disabled={!date} onChange={e => emit(date, e.target.value)} />
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onChange(null);
              setOpen(false);
              trigger.current?.focus();
            }}>
            {empty}
          </button>
        </div>
      </Popover>
    </>
  );
}

/* ── Searchable multi-picker ───────────────────────────────────────────── */

export type PickKind = 'product' | 'category' | 'department' | 'customer';

interface Option {
  id: string;
  name: string;
  detail?: string;
  image?: string | null;
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const imageOf = (img: PreviewTarget['image']): string | null => (!img ? null : typeof img === 'string' ? img : (img.src ?? img.url ?? null));

/** Options for a kind: products/customers come from the preview search, categories/departments from the taxonomy. */
function useOptions(kind: PickKind, q: string, active: boolean): {options: Option[]; loading: boolean; hint?: string} {
  const remote = kind === 'product' || kind === 'customer';
  const dq = useDebounced(q.trim());
  const preview = useQuery({...discountPreviewQuery(dq), enabled: active && remote && (kind === 'product' || dq.length > 0)});
  const taxonomy = useQuery(discountTaxonomyQuery());
  return useMemo(() => {
    if (kind === 'product')
      return {
        options: (preview.data?.products ?? []).map(p => ({id: p.id, name: p.name, image: imageOf(p.image)})),
        loading: preview.isFetching && !preview.data,
      };
    if (kind === 'customer') {
      if (!dq) return {options: [], loading: false, hint: 'Type a name or email to search customers.'};
      return {
        options: (preview.data?.customers ?? []).map(c => ({id: c.id, name: c.name, detail: c.email})),
        loading: preview.isFetching && !preview.data,
      };
    }
    const needle = q.trim().toLowerCase();
    const depts = taxonomy.data ?? [];
    const all: Option[] =
      kind === 'department'
        ? depts.map(d => ({id: d.id, name: d.name, detail: d.productCount >= 0 ? `${d.productCount} products` : undefined}))
        : depts.flatMap(d => d.categories.map(c => ({id: c.id, name: c.name, detail: d.name})));
    return {
      options: needle ? all.filter(o => `${o.name} ${o.detail ?? ''}`.toLowerCase().includes(needle)) : all,
      loading: taxonomy.isLoading,
    };
  }, [kind, preview.data, preview.isFetching, taxonomy.data, taxonomy.isLoading, q, dq]);
}

const PLACEHOLDER: Record<PickKind, string> = {
  product: 'Search products',
  category: 'Search categories',
  department: 'Search departments',
  customer: 'Search customers by name or email',
};

export function MultiPicker({
  id,
  kind,
  value,
  onChange,
  names,
  onName,
  invalid,
  describedBy: describedById,
  disabled,
}: {
  id: string;
  kind: PickKind;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Known display names by id. */
  names: Record<string, string>;
  /** Report a resolved display name (summary and chips). */
  onName: (id: string, name: string) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const {options, loading, hint} = useOptions(kind, q, open);
  const selected = new Set(value);

  // Products and customers chosen in an earlier session: resolve their names in one request.
  const lookupKind = kind === 'product' || kind === 'customer' ? kind : null;
  const unnamed = lookupKind ? value.filter(v => !names[v]) : [];
  const lookup = useQuery(discountNamesQuery(lookupKind ?? 'product', [...unnamed].sort().join(',')));
  useEffect(() => {
    for (const r of lookup.data ?? []) onName(r.id, r.name);
  }, [lookup.data, onName]);

  useEffect(() => setCursor(0), [q, kind]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (o: Option) => {
    onName(o.id, o.name);
    onChange(selected.has(o.id) ? value.filter(v => v !== o.id) : [...value, o.id]);
  };

  return (
    <div ref={wrap} className="picker">
      <div className="picker-box">
        <Icon name="search" size={16} className="picker-icon" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && options[cursor] ? `${id}-opt-${cursor}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedById}
          disabled={disabled}
          value={q}
          placeholder={PLACEHOLDER[kind]}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={e => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setCursor(c => Math.min(options.length - 1, c + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor(c => Math.max(0, c - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (open && options[cursor]) toggle(options[cursor]);
            } else if (e.key === 'Escape') {
              if (open) e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {open && (
          <ul id={`${id}-list`} role="listbox" aria-multiselectable="true" aria-label={PLACEHOLDER[kind]} className="picker-list">
            {loading ? (
              Array.from({length: 4}, (_, i) => (
                <li key={i} className="picker-loading" aria-hidden="true">
                  <Skeleton width="half" />
                </li>
              ))
            ) : options.length === 0 ? (
              <li className="picker-empty">{hint ?? (q ? 'No matches.' : 'Nothing to choose from.')}</li>
            ) : (
              options.map((o, i) => {
                const on = selected.has(o.id);
                return (
                  <li
                    key={o.id}
                    id={`${id}-opt-${i}`}
                    role="option"
                    aria-selected={on}
                    data-option={o.name}
                    data-active={i === cursor ? '' : undefined}
                    className="picker-option"
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => toggle(o)}>
                    {kind === 'product' && <Thumb src={o.image} />}
                    <span className="picker-option-text">
                      <span className="picker-option-name">{o.name}</span>
                      {o.detail && <span className="picker-option-detail">{o.detail}</span>}
                    </span>
                    <Icon name="check" size={16} className={on ? 'picker-check' : 'picker-check picker-check-off'} />
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <ul className="chips" aria-label="Selected">
          {value.map(v => (
            <Chip key={v} id={v} name={names[v]} onRemove={disabled ? undefined : () => onChange(value.filter(x => x !== v))} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Thumb({src}: {src?: string | null}) {
  return (
    <span className="picker-thumb">
      {src ? <img src={photoUrl(src, 80)} alt="" loading="lazy" width={24} height={32} /> : <Icon name="package" size={12} />}
    </span>
  );
}

/** Selected item (its name once known, the id until then). */
function Chip({id, name, onRemove}: {id: string; name?: string; onRemove?: () => void}) {
  const resolved = name ?? id;
  return (
    <li className="chip">
      <span className="chip-text">{resolved}</span>
      {onRemove && (
        <button type="button" className="chip-remove" aria-label={`Remove ${resolved}`} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      )}
    </li>
  );
}

/* ── List filters ──────────────────────────────────────────────────────── */

/** Toggle buttons that filter a list (VAREL `FilterToggles`): several may be on; "All" clears them. */
export function FilterToggles<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: {value: V; label: string}[];
  value: V[] | undefined;
  onChange: (value: V[] | undefined) => void;
}) {
  const on = new Set(value ?? []);
  return (
    <div className="filter-toggles" role="group" aria-label={label}>
      <button type="button" className="filter-toggle" aria-pressed={on.size === 0} onClick={() => onChange(undefined)}>
        All
      </button>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className="filter-toggle"
          aria-pressed={on.has(o.value)}
          onClick={() => {
            const next = new Set(on);
            if (next.has(o.value)) next.delete(o.value);
            else next.add(o.value);
            onChange(next.size ? options.filter(x => next.has(x.value)).map(x => x.value) : undefined);
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
