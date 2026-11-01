import type { Order } from '@/lib/types/orders'
import { cn } from '@/lib/utils'
import { useAccountT } from '../i18n'
import { statusTextClass } from './orderUtils'

/** Fulfilment status as a readable chip: tinted dot + sentence-case label (colour never carries it alone).
    Neutral states use the secondary ink: ink-400 is under 4.5:1 on white. (VAREL StatusChip, copied.) */
export function StatusChip({ status, className }: { status: Order['fulfillment']; className?: string }) {
  const t = useAccountT('orders')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-[13.5px] whitespace-nowrap',
        statusTextClass(status).replace('text-ink-400', 'text-text-secondary'),
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`fulfillment.${status.toLowerCase()}`, { defaultValue: status })}
    </span>
  )
}
