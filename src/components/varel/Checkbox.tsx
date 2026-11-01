import { useId, type ReactNode } from 'react'
import { Checkbox as UICheckbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { syntheticChange } from './events'

export interface CheckboxProps {
  checked?: boolean
  label?: ReactNode
  /** Result count shown parenthetically after the label */
  count?: number
  disabled?: boolean
  /** Event-like object: e.target.checked / value / name */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  /** Direct callback (extension) */
  onCheckedChange?: (checked: boolean) => void
  name?: string
  value?: string
  id?: string
  required?: boolean
  className?: string
  'aria-label'?: string
}

/** Square checkbox on shadcn ui/checkbox (Radix) — filter facets and consent lines. */
export function Checkbox({
  checked = false,
  label,
  count,
  disabled = false,
  onChange,
  onCheckedChange,
  name,
  value,
  id,
  required,
  className,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const autoId = useId()
  const boxId = id ?? autoId
  return (
    <span
      className={cn('relative inline-flex items-center gap-3', disabled && 'cursor-not-allowed opacity-40', className)}
    >
      <UICheckbox
        id={boxId}
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        required={required}
        aria-label={ariaLabel}
        onCheckedChange={(c) => {
          const next = c === true
          onCheckedChange?.(next)
          onChange?.(syntheticChange<HTMLInputElement>({ checked: next, value: value ?? 'on', name: name ?? '', id: boxId }))
        }}
      />
      {label != null && (
        <label htmlFor={boxId} className={cn('text-body-sm font-light', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
          {count != null && <span className="text-text-muted"> ({count})</span>}
        </label>
      )}
    </span>
  )
}
