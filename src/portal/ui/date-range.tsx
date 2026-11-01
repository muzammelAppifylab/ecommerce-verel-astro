import {type KeyboardEvent, useRef, useState} from 'react';
import {type DateRange, DayPicker} from 'react-day-picker';

import {parsePeriod, type Period} from '../queries/search-params';
import {Icon} from './icon';
import {Popover} from './popover';

export {parsePeriod, type Period};

/**
 * Report windows and date filters, ported from VAREL
 * (`components/admin/PeriodToggle.tsx`, `DateRangeFilter.tsx`).
 */

// ---------------------------------------------------------------- period --

export const PERIODS: {value: Period; label: string}[] = [
  {value: 7, label: '7 days'},
  {value: 30, label: '30 days'},
  {value: 90, label: '90 days'},
  {value: 'all', label: 'Lifetime'},
];

/**
 * Segmented 7 / 30 / 90 days / Lifetime control. `value` undefined selects
 * nothing (a custom date range is in force). Same keys as `SegmentedControl`.
 */
export function PeriodToggle({value, onChange, label = 'Period'}: {value: Period | undefined; onChange: (p: Period) => void; label?: string}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = PERIODS.findIndex(p => p.value === value);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
    const from = index < 0 ? 0 : index;
    const to = step ? (from + step + PERIODS.length) % PERIODS.length : event.key === 'Home' ? 0 : event.key === 'End' ? PERIODS.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    onChange(PERIODS[to]!.value);
    refs.current[to]?.focus();
  };
  return (
    <div className="segmented period-toggle" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {PERIODS.map((p, i) => (
        <button
          key={p.value}
          ref={node => {
            refs.current[i] = node;
          }}
          type="button"
          role="radio"
          className="segment"
          aria-checked={p.value === value}
          // Nothing picked (a custom range): the first one takes the Tab stop.
          tabIndex={p.value === value || (index < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(p.value)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ date range --

/** "2026-10-21" ⇄ local Date (no timezone drift). */
export const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fromISODate = (s?: string) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

const short = (d: Date, year = false) => d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', ...(year ? {year: 'numeric'} : {})});

function daysAgo(n: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

const PRESETS: {label: string; range: () => DateRange}[] = [
  {label: 'Today', range: () => ({from: daysAgo(0), to: daysAgo(0)})},
  {label: 'Last 7 days', range: () => ({from: daysAgo(6), to: daysAgo(0)})},
  {label: 'Last 30 days', range: () => ({from: daysAgo(29), to: daysAgo(0)})},
  {
    label: 'This month',
    range: () => {
      const t = daysAgo(0);
      return {from: new Date(t.getFullYear(), t.getMonth(), 1), to: t};
    },
  },
  {label: 'Last 90 days', range: () => ({from: daysAgo(89), to: daysAgo(0)})},
];

/** The trigger's words for a range: "3 Oct – 21 Oct 2026", "From 3 Oct 2026", "Until …", or the label. */
export function rangeLabel(from: string | undefined, to: string | undefined, label: string): string {
  const a = fromISODate(from);
  const b = fromISODate(to);
  if (!a && !b) return label;
  if (a && b) return `${short(a, a.getFullYear() !== b.getFullYear())} – ${short(b, true)}`;
  if (a) return `From ${short(a, true)}`;
  return `Until ${short(b!, true)}`;
}

/**
 * Date range filter for a toolbar: presets and a two-month calendar in a
 * popover. Emits ISO dates (`YYYY-MM-DD`), either end optional; picking one
 * day sets both ends to it. Dates after today cannot be picked.
 */
export function DateRangeFilter({
  from,
  to,
  onChange,
  label = 'Date',
}: {
  from?: string;
  to?: string;
  onChange: (next: {from?: string; to?: string}) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [today] = useState(() => daysAgo(0));
  const trigger = useRef<HTMLButtonElement>(null);
  const selected: DateRange | undefined = from || to ? {from: fromISODate(from), to: fromISODate(to)} : undefined;
  const text = rangeLabel(from, to, label);

  const emit = (r: DateRange | undefined) =>
    onChange({from: r?.from ? toISODate(r.from) : undefined, to: r?.to ? toISODate(r.to) : r?.from ? toISODate(r.from) : undefined});

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="filter-trigger"
        data-active={selected ? '' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={selected ? `${label}: ${text}` : label}
        onClick={() => setOpen(value => !value)}>
        <Icon name="calendar" size={16} />
        <span>{text}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={`Pick ${label.toLowerCase()}`} className="date-range-panel">
        <ul className="date-range-presets">
          {PRESETS.map(p => (
            <li key={p.label}>
              <button
                type="button"
                onClick={() => {
                  emit(p.range());
                  setOpen(false);
                  trigger.current?.focus();
                }}>
                {p.label}
              </button>
            </li>
          ))}
          {selected && (
            <li className="date-range-clear">
              <button
                type="button"
                onClick={() => {
                  emit(undefined);
                  setOpen(false);
                  trigger.current?.focus();
                }}>
                Clear dates
              </button>
            </li>
          )}
        </ul>
        <DayPicker
          mode="range"
          numberOfMonths={2}
          defaultMonth={selected?.from ?? new Date(today.getFullYear(), today.getMonth() - 1, 1)}
          selected={selected}
          onSelect={emit}
          disabled={{after: today}}
          weekStartsOn={1}
        />
      </Popover>
    </>
  );
}
