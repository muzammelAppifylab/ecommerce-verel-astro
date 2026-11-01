/* VAREL `src/pages/auth/ui.tsx` components as class recipes for the `.astro` sign-in pages. */

/** AuthTitle 46 (login / signup) */
export const TITLE_46 = 'm-0 mb-3.5 font-display font-normal leading-tight tracking-display text-[38px] md:text-[46px]'
/** AuthTitle 44 (reset, verify, confirm-email) */
export const TITLE_44 = 'm-0 mb-3.5 font-display font-normal leading-tight tracking-display text-[36px] md:text-[44px]'
/** AuthIntro */
export const INTRO = 'm-0 mb-9 text-[15px] leading-body text-text-secondary'
/** AuthSubmit: full-width obsidian button, 11px tracked label, 18px vertical padding */
export const SUBMIT =
  'inline-flex items-center justify-center gap-2 border-0 bg-ink-900 px-6 py-[18px] font-sans text-label-sm leading-none font-normal tracking-label text-text-inverse uppercase transition-hover hover:bg-ink-700 active:opacity-48 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink-900'
/** Reset "sent" / "done" buttons */
const SECONDARY =
  'inline-flex items-center justify-center border px-6 py-4 font-sans text-label-sm leading-none font-normal tracking-label uppercase transition-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink-900'
export const SECONDARY_SOLID = `${SECONDARY} border-transparent bg-ink-900 text-text-inverse hover:bg-ink-700`
export const SECONDARY_OUTLINE = `${SECONDARY} border-strong bg-transparent text-text-primary hover:bg-ink-900 hover:text-text-inverse`
/** "Create an account" under the login form */
export const OUTLINE_BLOCK =
  'border border-strong px-6 py-[17px] text-center text-label-sm leading-none font-normal tracking-label uppercase transition-hover hover:bg-ink-900 hover:text-text-inverse'
/** "Forgot password" and the login method toggles */
export const UNDERLINE_LINK =
  'cursor-pointer border-0 border-b border-strong bg-transparent p-0 pb-0.5 font-sans text-label-md font-normal tracking-label text-text-primary uppercase'
/** "Back to sign in", "Continue as a guest" */
export const QUIET_LINK = 'self-start border-0 text-body-xs text-text-secondary hover:text-text-primary'
/** AuthCheck (align start) */
export const CHECK_LABEL = 'flex cursor-pointer items-start gap-3 text-body-sm leading-body text-text-secondary'
export const CHECK_INPUT = 'm-0 mt-[3px] size-3.5 shrink-0 accent-ink-900'
/** Inline links inside copy (terms, privacy) */
export const TEXT_LINK = 'border-b border-current text-text-primary'
