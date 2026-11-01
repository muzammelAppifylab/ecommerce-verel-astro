import * as React from "react"
import { cn } from "@/lib/utils"

/* VAREL message box (Contact): hairline box, 16px padding, vertical resize. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full resize-y rounded-none border border-hairline bg-transparent p-4 font-sans text-body-md leading-body font-light text-text-primary outline-none transition-hover",
        "placeholder:text-text-muted focus:border-strong focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-signal-critical",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
