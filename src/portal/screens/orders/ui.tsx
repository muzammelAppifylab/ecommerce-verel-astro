/* Small building blocks shared by the orders and returns admin screens (port of VAREL
   src/pages/admin/orders/ui.tsx on the portal kit). */

import {Link} from '@tanstack/react-router';
import {type ReactNode, useRef, useState} from 'react';

import {money as formatMoney} from '../../../lib/format';
import {ApiError} from '../../api';
import {
  Button,
  type Column,
  ErrorNote,
  Icon,
  Modal,
  Notice,
  Popover,
  Skeleton,
  StatusBadge,
  type Tone,
} from '../../ui';

/** ONE status → tone map for orders, returns and the guest badge (VAREL StatusBadge colours). */
export const TONE: Record<string, Tone> = {
  Paid: 'success',
  Pending: 'warning',
  Refunded: 'neutral',
  Failed: 'danger',
  Unfulfilled: 'warning',
  Processing: 'info',
  Shipped: 'info',
  Delivered: 'success',
  Returned: 'neutral',
  Cancelled: 'neutral',
  Requested: 'warning',
  Approved: 'info',
  Received: 'info',
  Rejected: 'danger',
  Guest: 'neutral',
};

export function Status({status}: {status: string}) {
  return <StatusBadge tone={TONE[status] ?? 'neutral'}>{status}</StatusBadge>;
}

/* ---------- Formatting (VAREL lib/format + admin formatDateTime) ---------- */

/** Money in the order's currency (the admin works in the source language). */
export const money = (n: number, currency?: string | null) => formatMoney(n, currency, 'en');
export const minusMoney = (n: number, currency?: string | null) => '−' + money(Number(n.toFixed(2)), currency);

export function pluralize(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function dotJoin(...parts: (string | number | null | undefined | false)[]): string {
  return parts.filter(p => p !== null && p !== undefined && p !== false && p !== '').join(' · ');
}

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
const dateFormat = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});

/** "18 Aug 2026, 14:05" in the viewer's time zone. */
export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFormat.format(d);
};
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFormat.format(d);
};

export const isMissing = (error: unknown) => error instanceof ApiError && error.status === 404;
export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'That did not work. Try again.');

/* ---------- CSV (client side, selected rows) ---------- */

/** A CSV cell, quoted when needed and guarded against spreadsheet formulas (as the server's `csvCell`). */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvText = (rows: (string | number | null | undefined)[][]) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Saves a blob as a file through a temporary link. */
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

/* ---------- Filters ---------- */

/** Multi-select filter as a compact dropdown: "Payment · 2". */
export function FilterMenu<T extends string>({
  label,
  options,
  value,
  onChange,
  optionLabel,
}: {
  label: string;
  options: readonly T[];
  value: T[] | undefined;
  onChange: (next: T[] | undefined) => void;
  optionLabel?: (o: T) => string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = value ?? [];
  const toggle = (o: T, on: boolean) => {
    const next = on ? [...selected, o] : selected.filter(s => s !== o);
    onChange(next.length ? options.filter(x => next.includes(x)) : undefined);
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="filter-trigger"
        data-active={selected.length ? '' : undefined}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        {label}
        {selected.length > 0 && (
          <span className="sales-filter-count" aria-label={`${selected.length} selected`}>
            {selected.length}
          </span>
        )}
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={`Filter by ${label.toLowerCase()}`}>
        <fieldset className="sales-filter-panel">
          <legend className="visually-hidden">{label}</legend>
          {options.map(o => (
            <label key={o} className="sales-filter-option">
              <input type="checkbox" checked={selected.includes(o)} onChange={e => toggle(o, e.target.checked)} />
              {optionLabel ? optionLabel(o) : o}
            </label>
          ))}
          {selected.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
              Clear
            </Button>
          )}
        </fieldset>
      </Popover>
    </>
  );
}

/* ---------- Selection ---------- */

/** The checkbox column of a list with bulk actions; the header box selects every LOADED row. */
export function selectColumn<Row>({
  rows,
  keyOf,
  labelOf,
  selected,
  onChange,
}: {
  rows: Row[];
  keyOf: (row: Row) => string;
  labelOf: (row: Row) => string;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}): Column<Row> {
  const all = rows.length > 0 && rows.every(r => selected.has(keyOf(r)));
  const some = !all && rows.some(r => selected.has(keyOf(r)));
  return {
    key: 'select',
    width: 'shrink',
    header: (
      <input
        type="checkbox"
        className="sales-select"
        aria-label="Select all loaded rows"
        checked={all}
        ref={node => {
          if (node) node.indeterminate = some;
        }}
        onChange={e => onChange(e.target.checked ? new Set(rows.map(keyOf)) : new Set())}
      />
    ),
    cell: row => {
      const key = keyOf(row);
      return (
        <input
          type="checkbox"
          className="sales-select"
          aria-label={`Select ${labelOf(row)}`}
          checked={selected.has(key)}
          onChange={e => {
            const next = new Set(selected);
            if (e.target.checked) next.add(key);
            else next.delete(key);
            onChange(next);
          }}
        />
      );
    },
  };
}

/* ---------- Detail pieces ---------- */

/** "← Orders" above a detail screen's header. */
export function BackLink({to, children}: {to: '/orders' | '/returns'; children: ReactNode}) {
  return (
    <Link to={to} className="sales-back">
      <Icon name="arrow-left" size={14} />
      {children}
    </Link>
  );
}

/** A failed read, in words, with "Try again" when it can help. */
export function LoadFailed({error, title, onRetry}: {error: unknown; title: string; onRetry?: () => void}) {
  return (
    <div className="sales-load-error">
      <ErrorNote error={error instanceof Error ? error : new Error(errorText(error))} title={title} />
      {onRetry && (
        <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Skeleton for a detail screen: header + two-column panels. */
export function DetailSkeleton() {
  return (
    <div className="sales-skeleton" role="status" aria-busy="true">
      <span className="visually-hidden">Loading…</span>
      <Skeleton width="third" />
      <Skeleton width="half" />
      <div className="sales-detail-grid">
        <div className="sales-stack">
          <Skeleton lines={6} />
          <Skeleton lines={4} />
        </div>
        <div className="sales-stack">
          <Skeleton lines={4} />
          <Skeleton lines={3} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Confirm with a body (lists, inputs) ---------- */

/**
 * A confirmation whose body holds more than a sentence (a list of orders, a checkbox and a note).
 * `useConfirm` takes text only; this is the same dialog: Cancel + the verb, pending while it runs,
 * the error in the dialog, never closable mid-action.
 */
export function ConfirmModal({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  pendingLabel,
  tone = 'primary',
  pending,
  error,
  onConfirm,
  formId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  error?: string | null;
  /** Ignored when `formId` is given (the form's submit handles it). */
  onConfirm?: () => void;
  /** The id of a `<form>` in `children` the confirm button submits. */
  formId?: string;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!pending}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={tone}
            type={formId ? 'submit' : 'button'}
            form={formId}
            pending={pending}
            pendingLabel={pendingLabel}
            onClick={formId ? undefined : onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }>
      {children}
      {error && <Notice tone="danger">{error}</Notice>}
    </Modal>
  );
}
