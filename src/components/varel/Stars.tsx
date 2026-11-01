import { useId } from 'react'
import { cn } from '@/lib/utils'

const STAR = 'M10 1.6l2.47 5.18 5.68.7-4.18 3.93 1.07 5.63L10 14.29l-5.04 2.75 1.07-5.63L1.85 7.48l5.68-.7z'

/** Five hairline stars, filled in ink up to `value` (fractions supported). Decorative unless `label` is given. */
export function Stars({ value, size = 13, className, label }: { value: number; size?: number; className?: string; label?: string }) {
  const id = useId()
  const pct = Math.max(0, Math.min(5, value)) / 5
  return (
    <span
      className={cn('inline-flex shrink-0 items-center text-ink-900', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width={size * 5 + 8} height={size} viewBox="0 0 108 20" fill="none">
        <defs>
          <clipPath id={`${id}-fill`}>
            <rect x="0" y="0" width={108 * pct} height="20" />
          </clipPath>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} transform={`translate(${i * 22} 0)`}>
            <path d={STAR} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          </g>
        ))}
        <g clipPath={`url(#${id}-fill)`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} transform={`translate(${i * 22} 0)`}>
              <path d={STAR} fill="currentColor" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            </g>
          ))}
        </g>
      </svg>
    </span>
  )
}
