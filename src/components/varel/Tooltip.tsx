import type { ReactNode } from 'react'
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface TooltipProps {
  content?: ReactNode
  placement?: 'top' | 'bottom'
  children?: ReactNode
}

/** Short factual hint on hover/focus (shadcn ui/tooltip), six words maximum. Self-contained: islands have no
 *  app-wide root, so each tooltip brings its own <TooltipProvider> (VAREL mounted one in main.tsx). */
export function Tooltip({ content, placement = 'top', children }: TooltipProps) {
  return (
    <TooltipProvider>
      <UITooltip>
        <TooltipTrigger asChild>
          <span className="relative inline-flex">{children}</span>
        </TooltipTrigger>
        <TooltipContent side={placement} sideOffset={8}>
          {content}
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  )
}
