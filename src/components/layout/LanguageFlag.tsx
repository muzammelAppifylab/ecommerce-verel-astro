import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/* Flag for a storefront language — inline SVG, not emoji (emoji flags don't render on Windows, and VAREL avoids emoji).
   A language maps to the flag most shoppers expect; English uses the UK flag. Unknown codes get a neutral tile. */
const LANGUAGE_FLAG: Record<string, string> = {
  en: 'gb',
  da: 'dk',
  de: 'de',
  fr: 'fr',
  es: 'es',
  sv: 'se',
  nb: 'no',
  nl: 'nl',
  it: 'it',
  fi: 'fi',
  pt: 'pt',
  pl: 'pl',
}

type FlagArt = (id: string) => ReactNode

/** Drawn on a 30×20 canvas (3:2). */
const FLAGS: Record<string, FlagArt> = {
  gb: (id) => (
    <>
      <clipPath id={`${id}-c`}>
        <rect width="30" height="20" />
      </clipPath>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="30" height="20" fill="#012169" />
        <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
        <path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
        <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
        <path d="M15 0V20M0 10H30" stroke="#C8102E" strokeWidth="3.4" />
      </g>
    </>
  ),
  dk: () => (
    <>
      <rect width="30" height="20" fill="#C8102E" />
      <rect x="9" width="3" height="20" fill="#fff" />
      <rect y="8.5" width="30" height="3" fill="#fff" />
    </>
  ),
  se: () => (
    <>
      <rect width="30" height="20" fill="#006AA7" />
      <rect x="9" width="3.5" height="20" fill="#FECC02" />
      <rect y="8.25" width="30" height="3.5" fill="#FECC02" />
    </>
  ),
  no: () => (
    <>
      <rect width="30" height="20" fill="#BA0C2F" />
      <rect x="8" width="5" height="20" fill="#fff" />
      <rect y="7.5" width="30" height="5" fill="#fff" />
      <rect x="9.25" width="2.5" height="20" fill="#00205B" />
      <rect y="8.75" width="30" height="2.5" fill="#00205B" />
    </>
  ),
  fi: () => (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect x="8" width="4" height="20" fill="#002F6C" />
      <rect y="8" width="30" height="4" fill="#002F6C" />
    </>
  ),
  de: () => (
    <>
      <rect width="30" height="6.67" fill="#000" />
      <rect y="6.67" width="30" height="6.67" fill="#DD0000" />
      <rect y="13.33" width="30" height="6.67" fill="#FFCE00" />
    </>
  ),
  nl: () => (
    <>
      <rect width="30" height="6.67" fill="#AE1C28" />
      <rect y="6.67" width="30" height="6.67" fill="#fff" />
      <rect y="13.33" width="30" height="6.67" fill="#21468B" />
    </>
  ),
  fr: () => (
    <>
      <rect width="10" height="20" fill="#002654" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#CE1126" />
    </>
  ),
  it: () => (
    <>
      <rect width="10" height="20" fill="#008C45" />
      <rect x="10" width="10" height="20" fill="#F4F5F0" />
      <rect x="20" width="10" height="20" fill="#CD212A" />
    </>
  ),
  es: () => (
    <>
      <rect width="30" height="20" fill="#AA151B" />
      <rect y="5" width="30" height="10" fill="#F1BF00" />
    </>
  ),
  pt: () => (
    <>
      <rect width="30" height="20" fill="#FF0000" />
      <rect width="12" height="20" fill="#006600" />
      <circle cx="12" cy="10" r="3.4" fill="#FFCC00" />
    </>
  ),
  pl: () => (
    <>
      <rect width="30" height="10" fill="#fff" />
      <rect y="10" width="30" height="10" fill="#DC143C" />
    </>
  ),
}

export interface LanguageFlagProps {
  /** Language code, e.g. "da" */
  locale: string
  /** Width in px; height follows the 3:2 ratio. Default 20. */
  size?: number
  className?: string
}

/** Decorative flag for a language (the language name is always shown or announced next to it). */
export function LanguageFlag({ locale, size = 20, className }: LanguageFlagProps) {
  const id = useId().replace(/:/g, '')
  const art = FLAGS[LANGUAGE_FLAG[locale] ?? '']
  return (
    <svg
      viewBox="0 0 30 20"
      width={size}
      height={(size * 2) / 3}
      aria-hidden="true"
      focusable="false"
      className={cn('inline-block shrink-0 align-middle', className)}
    >
      {art ? art(id) : <rect width="30" height="20" fill="var(--ink-100)" />}
      {/* hairline edge so white fields read on white surfaces */}
      <rect x="0.25" y="0.25" width="29.5" height="19.5" fill="none" stroke="rgba(26,26,26,.18)" strokeWidth="0.5" />
    </svg>
  )
}
