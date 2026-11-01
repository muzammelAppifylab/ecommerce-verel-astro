import * as React from "react"
import { cn } from "@/lib/utils"
import { Label as LabelPrimitive } from "radix-ui"

/* VAREL field label: 12px tracked uppercase, secondary ink. */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 font-sans text-label-md font-normal tracking-label text-text-secondary uppercase select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-40 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-40",
        className
      )}
      {...props}
    />
  )
}

export { Label }
