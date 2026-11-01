import { cn } from "@/lib/utils"

/* VAREL skeleton: flat chalk block, slow pulse (1.6s), no shimmer, no radius. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-none bg-ink-050 [animation-duration:1.6s]", className)}
      {...props}
    />
  )
}

export { Skeleton }
