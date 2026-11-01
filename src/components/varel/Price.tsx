import { cn } from '@/lib/utils'

export interface PriceProps {
  /** Formatted current price, e.g. "$148" (use money()/priceText()) */
  amount: string
  /** Formatted previous price, struck through */
  compareAt?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** Price display. Reduced prices sit quietly beside the current one. Colour is inherited
 *  (tiles set text-signal-critical on the wrapper when on sale, as in the prototype). */
export function Price({ amount, compareAt, size = 'md', className }: PriceProps) {
  const fs = size === 'lg' ? 'text-body-lg' : size === 'sm' ? 'text-body-sm' : 'text-body-md'
  return (
    <span className={cn('inline-flex items-baseline gap-3 font-light', fs, className)}>
      <span>{amount}</span>
      {compareAt && <span className="text-body-sm text-text-muted line-through">{compareAt}</span>}
    </span>
  )
}
