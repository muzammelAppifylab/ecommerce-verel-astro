/* Shared class strings for the bag, checkout, confirmation and wishlist pages (prototype inline styles → tokens). */

/** 11px tracked uppercase micro-label (inherits weight like the prototype spans). */
export const LABEL = 'text-label-sm tracking-label uppercase'

/** Section heading rendered as a micro-label (the prototype h2s use Lato, not Cormorant). */
export const LABEL_HEADING = 'm-0 font-sans text-label-sm font-light tracking-label uppercase'

/** Solid obsidian call to action used as a link (Checkout, Continue shopping …). */
export const SOLID_CTA =
  'inline-block border-0 bg-ink-900 text-center text-label-sm tracking-label text-text-inverse uppercase transition-hover hover:bg-ink-700 hover:text-text-inverse'

/** Hairline outline call to action. */
export const OUTLINE_CTA =
  'inline-block border border-strong bg-transparent text-center text-label-sm tracking-label text-text-primary uppercase transition-hover hover:bg-ink-900 hover:text-text-inverse'

/** Underlined text link ("Continue shopping", "All products"). */
export const UNDERLINE_LINK =
  'border-0 border-b border-strong pb-1 text-label-sm tracking-label text-text-primary uppercase hover:text-ink-500'

/** Cormorant page title (52px desktop). */
export const PAGE_TITLE = 'm-0 font-display text-[40px] leading-tight font-normal tracking-display md:text-[52px]'
