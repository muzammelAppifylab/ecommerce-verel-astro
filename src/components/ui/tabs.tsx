import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("flex flex-col gap-6", className)}
      {...props}
    />
  )
}

/* VAREL tabs: hairline baseline, 32px gaps, active item carries a 2px obsidian rule. */
const tabsListVariants = cva("flex gap-8 overflow-x-auto border-b border-hairline", {
  variants: {
    variant: { default: "", line: "" },
    align: { left: "justify-start", center: "justify-center" },
  },
  defaultVariants: { variant: "default", align: "left" },
})

function TabsList({
  className,
  variant = "default",
  align = "left",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant, align }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px shrink-0 rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 pb-3 font-sans text-label-md font-normal tracking-label whitespace-nowrap text-text-muted uppercase transition-hover outline-none",
        "hover:text-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40",
        "data-active:border-strong data-active:text-text-primary data-[state=active]:border-strong data-[state=active]:text-text-primary",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-body-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
