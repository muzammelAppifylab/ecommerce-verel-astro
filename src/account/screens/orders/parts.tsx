/* Account kit pieces the order screens use (VAREL src/pages/account/AccountShell.tsx `AccountHeader`,
   src/pages/account/ConfirmDialog.tsx). WP-13 ports the same two for its own screens; these copies keep WP-14
   independent of merge order (the integrator may dedupe after both merge: hand-off note). */
import type {ReactNode} from 'react';

import {Dialog, Spinner} from '@/components/varel';

import {useOrdersT} from './host';
import {outlineAction, solidAction} from './recipes';

/** The account page header: h1 (34/42 px display), description, actions. */
export function AccountHeader({title, description, actions}: {title: ReactNode; description?: ReactNode; actions?: ReactNode}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-hairline pb-6">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="m-0 font-display text-[34px] leading-[1.1] font-normal tracking-display [font-variant-numeric:lining-nums] md:text-[42px]">
          {title}
        </h1>
        {description && <div className="m-0 max-w-[60ch] text-[15px] leading-body text-text-secondary">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Label of the dismiss button (default "Cancel") */
  cancelLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  error?: string | null;
  /** Critical styling for destructive confirmations */
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Small confirmation modal. While pending: spinner + present-tense label, both buttons disabled, Esc ignored. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  pending,
  error,
  destructive,
  onConfirm,
  onClose,
}: ConfirmProps) {
  const t = useOrdersT('account');
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      width={460}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={close} disabled={pending} className={outlineAction('px-6 py-[15px]')}>
            {cancelLabel ?? t('confirm.cancel', {defaultValue: 'Cancel'})}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending || undefined}
            className={solidAction(
              destructive ? 'bg-signal-critical px-7 py-[15px] hover:bg-signal-critical hover:opacity-90' : 'px-7 py-[15px]'
            )}>
            {pending && <Spinner size={12} />}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      }>
      <div className="flex flex-col gap-4 text-[15px] leading-body text-text-secondary">
        {children}
        {error && (
          <div role="alert" className="border border-signal-critical px-4 py-3.5 text-body-xs text-signal-critical">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
