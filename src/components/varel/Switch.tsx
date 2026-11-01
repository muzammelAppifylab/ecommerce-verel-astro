import { useId, type ReactNode } from 'react'
import { Switch as UISwitch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface SwitchProps {
  checked?: boolean
  label?: ReactNode
  disabled?: boolean
  onChange?: (next: boolean) => void
  className?: string
  id?: string
  name?: string
}

/** Immediate on/off preference on shadcn ui/switch — the one place VAREL uses a pill radius. */
export function Switch({ checked = false, label, disabled = false, onChange, className, id, name }: SwitchProps) {
  const autoId = useId()
  const switchId = id ?? autoId
  return (
    <span className={cn('inline-flex items-center gap-4', disabled && 'cursor-not-allowed opacity-40', className)}>
      <UISwitch id={switchId} name={name} checked={checked} disabled={disabled} onCheckedChange={(c) => onChange?.(c)} />
      {label != null && (
        <label htmlFor={switchId} className={cn('text-body-sm font-light', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
        </label>
      )}
    </span>
  )
}
