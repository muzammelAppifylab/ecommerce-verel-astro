import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from './Skeleton'

export interface ProductGridProps {
  children?: ReactNode
  /** Desktop columns (prototype: 3 on Shop/Category/Wishlist, 4 on Home) */
  columns?: 2 | 3 | 4
  className?: string
}

const COLS = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }

/** Responsive product grid: 2 columns on mobile, `columns` on desktop, gap 40px × 20px. */
export function ProductGrid({ children, columns = 3, className }: ProductGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 sm:gap-y-10', COLS[columns], className)}>{children}</div>
  )
}

/** Loading placeholder for one tile. */
export function ProductTileSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3.5', className)} aria-hidden="true">
      <Skeleton className="aspect-[3/4] w-full" />
      <div className="flex justify-between gap-4">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-5 w-12" />
      </div>
      <Skeleton className="h-3.5 w-4/5" />
    </div>
  )
}

/** A grid of tile skeletons. */
export function ProductGridSkeleton({ count = 6, columns = 3, className }: { count?: number; columns?: 2 | 3 | 4; className?: string }) {
  return (
    <ProductGrid columns={columns} className={className}>
      {Array.from({ length: count }, (_, i) => (
        <ProductTileSkeleton key={i} />
      ))}
    </ProductGrid>
  )
}
