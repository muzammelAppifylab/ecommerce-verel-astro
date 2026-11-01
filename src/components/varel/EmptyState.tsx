import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** Cormorant 32px, e.g. "Your bag is empty." */
  title: ReactNode
  description?: ReactNode
  /** Usually a <Button variant="outline"> or <Button to="/shop"> */
  action?: ReactNode
  /** Hairline box (default true) */
  bordered?: boolean
  className?: string
}

/** Centred empty / no-results block (Shop "Nothing matches these filters", Cart "Your bag is empty."). */
export function EmptyState({ title, description, action, bordered = true, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 px-6 py-16 text-center md:px-12 md:py-24',
        bordered && 'border border-hairline',
        className,
      )}
    >
      <h2 className="m-0 font-display text-display-4 font-normal">{title}</h2>
      {description && <p className="m-0 max-w-[40ch] text-[15px] text-text-secondary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
