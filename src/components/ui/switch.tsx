"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

/* VAREL switch — the only pill radius in the system. 40×20 track, 16px thumb, 240ms standard easing. */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-5 w-10 shrink-0 items-center rounded-pill border-0 p-0 transition-colors duration-240 ease-standard outline-none",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "data-checked:bg-ink-900 data-unchecked:bg-ink-200 data-disabled:cursor-not-allowed",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-ink-000 transition-transform duration-240 ease-standard data-checked:translate-x-[22px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
