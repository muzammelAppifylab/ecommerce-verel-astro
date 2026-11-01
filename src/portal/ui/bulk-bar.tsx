import {type ReactNode, useEffect} from 'react';

import {Icon, type IconName} from './icon';

/**
 * The floating toolbar for actions on the selected rows of a list, ported
 * from VAREL (`components/admin/kit.tsx` `BulkBar`, `BulkAction`): "3 orders
 * selected · Mark fulfilled · Export · ×". Shown while something is selected;
 * Esc (outside a dialog or menu) or × clears the selection.
 *
 *   <BulkBar count={ids.size} noun={['order', 'orders']} onClear={clear}>
 *     <BulkAction icon="download" pending={exporting} pendingLabel="Exporting…" onClick={exportCsv}>Export</BulkAction>
 *   </BulkBar>
 */
export function BulkBar({count, noun, onClear, children}: {count: number; noun: [string, string]; onClear: () => void; children: ReactNode}) {
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, onClear]);

  if (!count) return null;
  return (
    <div className="bulk-bar-wrap">
      <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
        <span className="bulk-bar-count" aria-live="polite">
          {count}
          <span className="bulk-bar-noun"> {count === 1 ? noun[0] : noun[1]}</span> selected
        </span>
        <span className="bulk-bar-rule" aria-hidden="true" />
        {children}
        <span className="bulk-bar-rule" aria-hidden="true" />
        <button type="button" className="bulk-bar-clear" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

/** A text action inside `<BulkBar>`: pending while it runs (spinner, present-tense label, never pressed twice). */
export function BulkAction({
  onClick,
  disabled,
  pending,
  pendingLabel,
  icon,
  danger,
  hint,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  /** "Exporting…" while `pending`. */
  pendingLabel?: string;
  icon?: IconName;
  danger?: boolean;
  /** A tooltip, e.g. why it is disabled. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="bulk-action"
      data-danger={danger ? '' : undefined}
      data-icon={icon ? '' : undefined}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending ? true : undefined}
      title={hint}>
      {pending ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {/* Icon-only on phones so the bar fits; the label stays for screen readers. */}
      <span className="bulk-action-label">{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}
