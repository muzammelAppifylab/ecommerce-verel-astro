import { useId } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select as UISelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { syntheticChange } from './events'

export type SelectOption = string | { value: string; label: string; disabled?: boolean }

export interface SelectProps {
  label?: string
  value?: string
  defaultValue?: string
  options?: SelectOption[]
  disabled?: boolean
  error?: string | null
  /** Shown when nothing is selected (e.g. "Choose a country") */
  placeholder?: string
  /** Receives an event-like object: e.target.value / e.target.name work as with a native select */
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  /** Direct value callback (extension) */
  onValueChange?: (value: string) => void
  name?: string
  id?: string
  required?: boolean
  /** Passed to the hidden native select (e.g. "country-name") */
  autoComplete?: string
  className?: string
  'aria-label'?: string
}

// Radix Select reserves "" for "no value"; map empty option values to a sentinel.
const EMPTY = '__varel_empty__'
const toRadix = (v: string | undefined) => (v === undefined ? undefined : v === '' ? EMPTY : v)
const fromRadix = (v: string) => (v === EMPTY ? '' : v)

/** Select styled as an underlined field — sorting, country, quantity. Built on shadcn ui/select (Radix). */
export function Select({
  label,
  value,
  defaultValue,
  options = [],
  disabled = false,
  error,
  placeholder,
  onChange,
  onValueChange,
  name,
  id,
  required,
  autoComplete,
  className,
  'aria-label': ariaLabel,
}: SelectProps) {
  const autoId = useId()
  const triggerId = id ?? autoId
  // A value that matches no option (e.g. "" with a placeholder) shows the placeholder.
  const known = (v?: string) => v !== undefined && options.some((o) => (typeof o === 'string' ? o : o.value) === v)
  const radixValue = value === undefined ? undefined : known(value) ? toRadix(value) : ''
  return (
    <div className={cn('block', className)}>
      {label && (
        <Label htmlFor={triggerId} className="mb-2">
          {label}
        </Label>
      )}
      <UISelect
        value={radixValue}
        defaultValue={known(defaultValue) ? toRadix(defaultValue) : undefined}
        disabled={disabled}
        name={name}
        required={required}
        autoComplete={autoComplete}
        onValueChange={(v) => {
          const next = fromRadix(v)
          onValueChange?.(next)
          onChange?.(syntheticChange<HTMLSelectElement>({ value: next, name: name ?? '', id: triggerId }))
        }}
      >
        <SelectTrigger id={triggerId} aria-invalid={error ? true : undefined} aria-label={ariaLabel}>
          <SelectValue placeholder={placeholder ?? ''} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => {
            const v = typeof o === 'string' ? o : o.value
            const l = typeof o === 'string' ? o : o.label
            return (
              <SelectItem key={v} value={toRadix(v)!} disabled={typeof o === 'string' ? undefined : o.disabled}>
                {l}
              </SelectItem>
            )
          })}
        </SelectContent>
      </UISelect>
      {error && <span className="mt-2 block text-body-xs text-signal-critical">{error}</span>}
    </div>
  )
}
