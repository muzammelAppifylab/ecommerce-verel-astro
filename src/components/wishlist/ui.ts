/* Shared class strings of the wishlist page (VAREL src/pages/checkout/ui.ts, the four it uses). Copied here
   because the checkout UI module belongs to WP-12; keep them in step if the design changes. */

/** 11px tracked uppercase micro-label (inherits weight like the prototype spans). */
export const LABEL = 'text-label-sm tracking-label uppercase';

/** Solid obsidian call to action used as a link or button. */
export const SOLID_CTA =
  'inline-block border-0 bg-ink-900 text-center text-label-sm tracking-label text-text-inverse uppercase transition-hover hover:bg-ink-700 hover:text-text-inverse';

/** Underlined text link ("All products"). */
export const UNDERLINE_LINK =
  'border-0 border-b border-strong pb-1 text-label-sm tracking-label text-text-primary uppercase hover:text-ink-500';

/** Cormorant page title (52px desktop). */
export const PAGE_TITLE = 'm-0 font-display text-[40px] leading-tight font-normal tracking-display md:text-[52px]';
