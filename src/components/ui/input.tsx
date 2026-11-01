import * as React from "react"
import { cn } from "@/lib/utils"

/* VAREL field: a single bottom rule, no box, no radius. Rule turns obsidian on focus, critical when aria-invalid. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[46px] w-full min-w-0 rounded-none border-0 border-b border-hairline bg-transparent p-0 font-sans text-body-md font-light text-text-primary outline-none transition-hover",
        "placeholder:text-text-muted focus:border-strong focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
        "aria-invalid:border-signal-critical file:border-0 file:bg-transparent file:text-label-sm file:uppercase",
        className
      )}
      {...props}
    />
  )
}

export { Input }
