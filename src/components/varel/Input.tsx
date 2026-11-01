import { useId, type ComponentProps, type ReactNode } from 'react'
import { Input as UIInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface InputProps extends Omit<ComponentProps<'input'>, 'size' | 'style'> {
  label?: string
  hint?: ReactNode
  /** Replaces hint and turns the rule critical */
  error?: string | null
  type?: string
  value?: string
  placeholder?: string
  disabled?: boolean
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  /** Classes for the outer wrapper (use for grid placement) */
  className?: string
  /** Classes for the <input> itself */
  inputClassName?: string
  /** Element rendered at the right end of the field (e.g. a show-password IconButton) */
  trailing?: ReactNode
}

/** Underline-only text field (shadcn ui/input + ui/label). No box, no radius. */
export function Input({
  label,
  hint,
  error,
  type = 'text',
  disabled = false,
  className,
  inputClassName,
  trailing,
  id,
  ...rest
}: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const msgId = `${inputId}-msg`
  return (
    <div className={cn('block', className)}>
      {label && (
        <Label htmlFor={inputId} className="mb-2">
          {label}
        </Label>
      )}
      <div className="relative flex items-center">
        <UIInput
          id={inputId}
          type={type}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? msgId : undefined}
          className={cn(trailing && 'pr-10', inputClassName)}
          {...rest}
        />
        {trailing && <span className="absolute right-0 flex items-center">{trailing}</span>}
      </div>
      {(hint || error) && (
        <span
          id={msgId}
          role={error ? 'alert' : undefined}
          className={cn('mt-2 block text-body-xs', error ? 'text-signal-critical' : 'text-text-muted')}
        >
          {error || hint}
        </span>
      )}
    </div>
  )
}
