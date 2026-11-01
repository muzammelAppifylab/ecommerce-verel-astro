import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ProfileFieldProps = { label: string; error?: string; trailing?: ReactNode } & ComponentProps<'input'>

/** Account form field: readable label above a 15px underlined input, error below (VAREL ProfileField).
    `trailing` sits at the right end of the input (a show/hide button). */
export function ProfileField({ label, error, className, trailing, ...input }: ProfileFieldProps) {
  const id = input.id ?? `profile-${input.name}`
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-[13.5px] text-text-secondary">
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={cn(
            'w-full rounded-none border-0 border-b bg-transparent py-2.5 font-sans text-[15px] font-light text-text-primary outline-none transition-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
            error ? 'border-signal-critical' : 'border-hairline focus:border-strong',
            trailing && 'pr-10',
          )}
          {...input}
        />
        {trailing && <span className="absolute right-0 flex items-center">{trailing}</span>}
      </div>
      {error && (
        <span id={`${id}-err`} role="alert" className="text-body-xs text-signal-critical">
          {error}
        </span>
      )}
    </div>
  )
}
