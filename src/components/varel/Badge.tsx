import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'ink' | 'outline' | 'quiet' | 'positive' | 'critical'

const TONES: Record<BadgeTone, string> = {
  ink: 'bg-ink-900 text-ink-000',
  outline: 'bg-transparent text-ink-900 shadow-[inset_0_0_0_1px_var(--border-strong)]',
  quiet: 'bg-ink-050 text-ink-500',
  positive: 'bg-transparent text-signal-positive shadow-[inset_0_0_0_1px_currentColor]',
  critical: 'bg-transparent text-signal-critical shadow-[inset_0_0_0_1px_currentColor]',
}

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone
}

/** Merchandising flag on product media: New, Final pieces, Restocked. One per tile, top-left. */
export function Badge({ tone = 'ink', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-none px-2 font-sans text-label-sm leading-none tracking-label uppercase',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  )
}
