/* Journal storefront constants (port of VAREL src/pages/journal/shared.tsx). Tailwind class strings
   copied verbatim; they compile from src/styles/storefront.css (`@source "../components"`). */

/* Category blurbs live in the journal catalog under `categoryBlurb.<category slug>`. */

/** Author roles shown beside the byline on a post: author → `journal:authorRole.<key>`. */
export const AUTHOR_ROLE_KEY: Record<string, string> = {
  'Mira Halvorsen': 'studioDirector',
};

/** 11px tracked uppercase metadata line (light weight, as in the prototype). */
export const META = 'text-[11px] leading-snug tracking-label uppercase text-text-muted';

/** Page gutters 24 → 48px */
export const GUTTER = 'px-6 md:px-12';

/** Cormorant page title, 56px on desktop. */
export const PAGE_TITLE = 'm-0 font-display text-[40px] font-normal leading-tight tracking-display md:text-[56px]';

export const CHIP = 'inline-flex items-center border px-4 py-2.5 text-[11px] leading-snug tracking-label uppercase transition-hover';
export const CHIP_ON = 'border-strong bg-ink-900 text-ink-000 hover:border-strong hover:text-ink-000';
export const CHIP_OFF = 'border-hairline bg-transparent text-ink-900 hover:border-strong hover:text-ink-900';

/** Byline share / print buttons. */
export const SMALL_LINK =
  'cursor-pointer border-0 border-b border-hairline bg-transparent p-0 pb-0.5 text-[11px] leading-snug tracking-label uppercase text-text-primary transition-hover hover:border-strong hover:text-ink-500';

/** "shoulder-bags" → "Shoulder bags": the name of a category nobody has written in yet. */
export function unslug(s: string): string {
  const t = s.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Category slugs in URLs: lower-case letters, digits and dashes. */
export const CATEGORY_SLUG_RE = /^[a-z0-9-]{1,80}$/;

/** Post slugs in URLs (as the admin creates them). */
export const POST_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
