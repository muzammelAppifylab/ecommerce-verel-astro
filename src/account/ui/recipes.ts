/* Class recipes for the account pages — the prototype's inline button/link styles as token utilities
   (VAREL src/pages/account/ui.ts, copied; disabled states made visible per AGENTS.md). */
import { cn } from '@/lib/utils'

/** 11px tracked uppercase micro-label */
export const microLabel = 'font-sans text-label-sm font-normal tracking-label uppercase'

/** Hairline-boxed action (prototype: 1px strong border, 11px label, inverts on hover). Add padding per use. */
export function outlineAction(className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 border border-strong bg-transparent text-text-primary whitespace-nowrap',
    microLabel,
    'leading-none no-underline transition-hover hover:bg-ink-900 hover:text-text-inverse active:opacity-48',
    'disabled:cursor-not-allowed disabled:opacity-34',
    className,
  )
}

/** Solid obsidian action (prototype submit buttons). Add padding per use. */
export function solidAction(className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 border-0 bg-ink-900 text-text-inverse whitespace-nowrap',
    microLabel,
    'leading-none transition-hover hover:bg-ink-700 active:opacity-48 disabled:cursor-not-allowed disabled:opacity-60',
    className,
  )
}

/** Underlined text action ("All orders", "Edit", "Track"). */
export function underlineAction(className?: string) {
  return cn(
    'inline-flex items-center border-0 border-b border-strong bg-transparent p-0 text-text-primary',
    microLabel,
    'leading-snug transition-hover hover:text-ink-500 disabled:cursor-not-allowed disabled:opacity-60',
    className,
  )
}

/** Section title — Cormorant 30px */
export const sectionTitle = 'm-0 font-display text-[30px] font-normal leading-display'

/** Section title inside an account page — Cormorant 26px */
export const panelTitle = 'm-0 font-display text-[26px] font-normal leading-tight'

/** Page title — Cormorant 52px (clamped on small screens) */
export const pageTitle = 'm-0 font-display text-[40px] font-normal leading-tight tracking-display md:text-[52px]'
