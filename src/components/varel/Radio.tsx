import { useId, type ReactNode } from 'react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { syntheticChange } from './events'

export interface RadioProps {
  checked?: boolean
  label?: ReactNode
  name?: string
  value?: string
  disabled?: boolean
  /** Fires when this radio becomes selected; e.target.checked === true, e.target.value = value */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  id?: string
  className?: string
}

/** Single radio on shadcn ui/radio-group. Standalone API kept from the design system; for keyboard
 *  arrow navigation across options, compose RadioGroup + RadioGroupItem from '@/components/ui/radio-group'. */
export function Radio({ checked = false, label, name, value = 'on', disabled = false, onChange, id, className }: RadioProps) {
  const autoId = useId()
  const itemId = id ?? autoId
  return (
    <RadioGroup
      name={name}
      value={checked ? value : ''}
      disabled={disabled}
      onValueChange={() => onChange?.(syntheticChange<HTMLInputElement>({ checked: true, value, name: name ?? '', id: itemId }))}
      className={cn('inline-flex w-auto items-center gap-3', disabled && 'cursor-not-allowed opacity-40', className)}
    >
      <RadioGroupItem id={itemId} value={value} />
      {label != null && (
        <label htmlFor={itemId} className={cn('text-body-sm font-light', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
        </label>
      )}
    </RadioGroup>
  )
}
