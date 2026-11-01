import {type ReactNode, useEffect, useState} from 'react';

import {toastStore, type ToastItem} from '@/lib/stores/toast';
import {cn} from '@/lib/utils';

import {Icon, type IconName} from './Icon';

export interface ToastProps {
  open?: boolean;
  message?: ReactNode;
  /** Optional single action label, e.g. "View bag" */
  action?: string;
  tone?: 'ink' | 'quiet';
  onAction?: () => void;
  /** Leading glyph (extension). Default "check"; null for none (errors). */
  icon?: IconName | null;
  className?: string;
}

/** Transient confirmation, bottom-left of the viewport. Presentational: use `notify()` to show one. */
export function Toast({open = true, message, action, tone = 'ink', onAction, icon = 'check', className}: ToastProps) {
  if (!open) return null;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-6 px-5 py-4 font-sans text-body-sm font-light',
        tone === 'ink'
          ? 'bg-ink-900 text-ink-000'
          : 'bg-ink-000 text-ink-900 shadow-[inset_0_0_0_1px_var(--border-strong),var(--shadow-lift)]',
        className
      )}>
      <span className="inline-flex items-center gap-3">
        {icon && <Icon name={icon} size={14} />}
        {message}
      </span>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="border-0 border-b border-current bg-transparent p-0 text-label-sm tracking-label text-inherit uppercase">
          {action}
        </button>
      )}
    </div>
  );
}

export interface NotifyOptions {
  action?: string;
  onAction?: () => void;
  tone?: 'ink' | 'quiet';
  icon?: 'check' | 'alert' | 'info' | null;
  /** ms, default 4000 */
  duration?: number;
}

/** Show a VAREL toast (one at a time, bottom-left, auto-dismiss 4s).
 *  notify('Added to bag', { action: 'View bag', onAction: openBag }) */
export function notify(message: ReactNode, opts: NotifyOptions = {}) {
  return toastStore.show({
    message,
    action: opts.action,
    onAction: opts.onAction,
    tone: opts.tone ?? 'ink',
    icon: opts.icon === undefined ? 'check' : opts.icon,
    duration: opts.duration ?? 4000,
  });
}

/** Error variant: no check glyph. */
export function notifyError(message: ReactNode) {
  return notify(message, {icon: null});
}

/** The toast region, mounted ONCE per page by the storefront layouts (24px from the bottom-left, 16px on phones). */
export function Toaster() {
  const [toast, setToast] = useState<ToastItem | null>(() => toastStore.get());
  useEffect(() => toastStore.subscribe(setToast), []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-[70] max-w-[calc(100vw-32px)] md:bottom-6 md:left-6">
      {toast && (
        <div key={toast.id} className="pointer-events-auto animate-in fade-in-0 slide-in-from-bottom-2 duration-240">
          <Toast
            message={toast.message}
            action={toast.action}
            tone={toast.tone}
            icon={toast.icon}
            onAction={() => {
              toast.onAction?.();
              toastStore.dismiss(toast.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
