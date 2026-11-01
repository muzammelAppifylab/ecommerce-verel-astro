import { Tabs as UITabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type TabItem = string | { value: string; label: string }

export interface TabsProps {
  items?: TabItem[]
  value?: string
  align?: 'left' | 'center'
  onChange?: (value: string) => void
  className?: string
  /** aria-label for the tablist */
  label?: string
}

/** Horizontal section switch on shadcn ui/tabs (Radix: roving focus, arrow keys).
 *  Renders the tab row only — render the active panel yourself. For linked panels use ui/tabs directly. */
export function Tabs({ items = [], value, align = 'left', onChange, className, label }: TabsProps) {
  const first = items[0] === undefined ? undefined : typeof items[0] === 'string' ? items[0] : items[0].value
  return (
    <UITabs value={value ?? first} onValueChange={(v) => onChange?.(v)} className={cn('gap-0', className)}>
      <TabsList align={align} aria-label={label}>
        {items.map((it) => {
          const v = typeof it === 'string' ? it : it.value
          const l = typeof it === 'string' ? it : it.label
          return (
            <TabsTrigger key={v} value={v}>
              {l}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </UITabs>
  )
}
