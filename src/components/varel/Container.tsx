import type { ComponentProps, ElementType } from 'react'
import { cn } from '@/lib/utils'

export interface ContainerProps extends ComponentProps<'div'> {
  /** page = 1440px (default) · editorial = 820px · prose = 62ch */
  width?: 'page' | 'editorial' | 'prose'
  /** Side gutters 24px mobile / 48px desktop (default true) */
  gutters?: boolean
  as?: ElementType
}

const W = { page: 'max-w-page', editorial: 'max-w-editorial', prose: 'max-w-measure' }

/** Centred page column with VAREL gutters. */
export function Container({ width = 'page', gutters = true, as: Tag = 'div', className, ...rest }: ContainerProps) {
  return <Tag className={cn('mx-auto w-full', W[width], gutters && 'px-6 md:px-12', className)} {...rest} />
}
