"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon, MinusIcon } from "lucide-react"

/* VAREL square checkbox: 16px hairline box, obsidian fill when checked, 2px-stroke check. */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/checkbox peer relative flex size-4 shrink-0 items-center justify-center rounded-none border border-hairline bg-transparent text-ink-000 transition-hover outline-none",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed",
        "aria-invalid:border-signal-critical data-checked:border-strong data-checked:bg-ink-900 data-[state=checked]:border-strong data-[state=checked]:bg-ink-900 data-[state=indeterminate]:border-strong data-[state=indeterminate]:bg-ink-900",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current animate-in fade-in-0 zoom-in-50 duration-160 ease-out">
        <CheckIcon strokeWidth={2} className="size-[11px] group-data-[state=indeterminate]/checkbox:hidden" />
        <MinusIcon strokeWidth={2} className="hidden size-[11px] group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
