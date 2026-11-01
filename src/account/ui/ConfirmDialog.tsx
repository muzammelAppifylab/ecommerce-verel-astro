import type { ReactNode } from 'react'
import { Dialog, Spinner } from '@/components/varel'
import { useAccountT } from '../i18n'
import { outlineAction, solidAction } from './recipes'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  /** Label of the dismiss button (default "Cancel") */
  cancelLabel?: string
  pendingLabel?: string
  pending?: boolean
  error?: string | null
  /** Critical styling for destructive confirmations */
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Small confirmation modal (remove address, make default; WP-14: cancel order). While the action runs the
    confirm button shows a spinner + its pending label and the dialog cannot be dismissed. */
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
}: ConfirmDialogProps) {
  const t = useAccountT('account')
  const close = () => {
    if (!pending) onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      width={460}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={close} disabled={pending} className={outlineAction('px-6 py-[15px]')}>
            {cancelLabel ?? t('confirm.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending ? true : undefined}
            className={solidAction(
              destructive ? 'bg-signal-critical px-7 py-[15px] hover:bg-signal-critical hover:opacity-90' : 'px-7 py-[15px]',
            )}
          >
            {pending && <Spinner size={14} />}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-[15px] leading-body text-text-secondary">
        {children}
        {error && (
          <div role="alert" className="border border-signal-critical px-4 py-3.5 text-body-xs text-signal-critical">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  )
}
