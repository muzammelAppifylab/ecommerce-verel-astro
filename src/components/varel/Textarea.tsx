import { useId, type ComponentProps, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea as UITextarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface TextareaProps extends Omit<ComponentProps<'textarea'>, 'style'> {
  label?: string
  hint?: ReactNode
  error?: string | null
  className?: string
  textareaClassName?: string
}

/** Message field (Contact page) on shadcn ui/textarea: hairline box, 16px padding, vertical resize. */
export function Textarea({ label, hint, error, className, textareaClassName, id, rows = 6, ...rest }: TextareaProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const msgId = `${fieldId}-msg`
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <Label htmlFor={fieldId} className="text-text-muted">
          {label}
        </Label>
      )}
      <UITextarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? msgId : undefined}
        className={textareaClassName}
        {...rest}
      />
      {(hint || error) && (
        <span id={msgId} className={cn('text-label-md', error ? 'text-signal-critical' : 'text-text-muted')}>
          {error || hint}
        </span>
      )}
    </div>
  )
}
