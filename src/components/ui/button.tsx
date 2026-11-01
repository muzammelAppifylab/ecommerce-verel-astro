import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/* VAREL button skin. Squared, uppercase tracked label, hover = colour/fill change only,
   press = opacity .48, no translate. The design-system <Button> (components/varel) is built on this. */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-none border font-sans font-normal leading-none tracking-label uppercase whitespace-nowrap no-underline transition-hover outline-none select-none active:opacity-48 disabled:pointer-events-none disabled:opacity-34 aria-disabled:pointer-events-none aria-disabled:opacity-34 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** obsidian fill → ink-700 on hover */
        solid: "border-transparent bg-ink-900 text-text-inverse hover:bg-ink-700 hover:text-text-inverse",
        /** hairline that inverts to obsidian on hover */
        outline: "border-strong bg-transparent text-text-primary hover:bg-ink-900 hover:text-text-inverse",
        /** underlined text */
        quiet:
          "h-auto! border-0 border-b border-hairline bg-transparent px-0! pb-1.5 text-text-primary hover:border-strong hover:text-text-primary",
        /** white on dark/imagery */
        inverse: "border-transparent bg-ink-000 text-ink-900 hover:bg-ink-100 hover:text-ink-900",
        /** admin toolbars and icon actions: hairline box, sunken on hover (no inversion) */
        subtle:
          "border-hairline bg-surface-raised text-text-primary hover:border-ink-300 hover:bg-ink-050 hover:text-text-primary aria-expanded:border-ink-300 aria-expanded:bg-ink-050",
        /** shadcn compatibility aliases */
        default: "border-transparent bg-ink-900 text-text-inverse hover:bg-ink-700 hover:text-text-inverse",
        secondary: "border-transparent bg-ink-050 text-text-primary hover:bg-ink-100",
        ghost: "border-transparent bg-transparent text-text-primary hover:text-ink-500",
        destructive: "border-signal-critical bg-transparent text-signal-critical hover:bg-signal-critical hover:text-text-inverse",
        link: "h-auto! border-0 bg-transparent px-0! text-text-primary underline-offset-5 hover:underline",
      },
      size: {
        sm: "h-9 px-4 text-label-sm",
        md: "h-[46px] px-6 text-label-md",
        lg: "h-14 px-8 text-label-lg",
        default: "h-[46px] px-6 text-label-md",
        xs: "h-7 px-3 text-label-sm",
        icon: "size-10 p-0",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-8 p-0",
        "icon-lg": "size-11 p-0",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
      fullWidth: false,
    },
  }
)

function Button({
  className,
  variant = "solid",
  size = "md",
  fullWidth = false,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, fullWidth, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
