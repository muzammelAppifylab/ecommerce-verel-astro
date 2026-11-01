/*
 * The home hero as designed, and how a stored hero falls back to it field by field: VAREL
 * `src/pages/home/HomeHero.tsx` (`DEFAULT_HERO`, `resolveHero`). A copy for the dashboard (the storefront
 * home is WP-01's; keep both equal). Admin → Navigation → Home hero overrides any field (Setting.homeHero).
 */
import type {Photo} from '../../../lib/types/common';
import type {HomeHero} from '../../../lib/types/settings';

export const DEFAULT_HERO = {
  eyebrow: 'Autumn 2026',
  title: 'Modern essentials.\nConsidered deeply.',
  body: 'Everyday pieces cut from natural materials in small runs, made to be worn well past the season.',
  primaryCta: {label: 'Shop women', url: '/shop/women'},
  secondaryCta: {label: 'Shop men', url: '/shop/men'},
  image: {src: '/images/hero-studio-rail.jpg', credit: 'VAREL', creditHref: '/'} as Photo,
} satisfies Required<HomeHero>;

export type ResolvedHero = typeof DEFAULT_HERO;

/** Each field of the stored hero, falling back to the designed copy. */
export function resolveHero(h: HomeHero | undefined | null, d: ResolvedHero = DEFAULT_HERO): ResolvedHero {
  const cta = (c: HomeHero['primaryCta'], fallback: {label: string; url: string}) => (c && c.label?.trim() && c.url?.trim() ? c : fallback);
  return {
    eyebrow: h?.eyebrow?.trim() || d.eyebrow,
    title: h?.title?.trim() || d.title,
    body: h?.body?.trim() || d.body,
    primaryCta: cta(h?.primaryCta, d.primaryCta),
    secondaryCta: cta(h?.secondaryCta, d.secondaryCta),
    image: h?.image?.src ? h.image : d.image,
  };
}

export interface HeroForm {
  eyebrow: string;
  title: string;
  body: string;
  primaryLabel: string;
  primaryUrl: string;
  secondaryLabel: string;
  secondaryUrl: string;
  imageSrc: string;
  imageCredit: string;
}

/** The form always shows what the store shows: stored fields, else the designed copy. */
export function heroFormOf(h: HomeHero | undefined | null): HeroForm {
  const r = resolveHero(h);
  return {
    eyebrow: r.eyebrow,
    title: r.title,
    body: r.body,
    primaryLabel: r.primaryCta.label,
    primaryUrl: r.primaryCta.url,
    secondaryLabel: r.secondaryCta.label,
    secondaryUrl: r.secondaryCta.url,
    imageSrc: r.image.src,
    imageCredit: r.image.credit ?? '',
  };
}

/** Only what differs from the designed hero is stored, so future design updates still reach untouched fields. */
export function toHero(f: HeroForm): HomeHero {
  const d = DEFAULT_HERO;
  const out: HomeHero = {};
  const t = (s: string) => s.replace(/\r/g, '').trim();
  if (t(f.eyebrow) !== d.eyebrow) out.eyebrow = t(f.eyebrow);
  if (t(f.title) !== d.title) out.title = t(f.title);
  if (t(f.body) !== d.body) out.body = t(f.body);
  if (t(f.primaryLabel) !== d.primaryCta.label || t(f.primaryUrl) !== d.primaryCta.url) out.primaryCta = {label: t(f.primaryLabel), url: t(f.primaryUrl)};
  if (t(f.secondaryLabel) !== d.secondaryCta.label || t(f.secondaryUrl) !== d.secondaryCta.url) out.secondaryCta = {label: t(f.secondaryLabel), url: t(f.secondaryUrl)};
  if (t(f.imageSrc) !== d.image.src) out.image = {src: t(f.imageSrc), credit: t(f.imageCredit), creditHref: ''};
  return out;
}

const HERO_URL_OK = (s: string) => /^\/(?!\/)/.test(s) || /^https?:\/\/\S+$/i.test(s);

export function validateHero(f: HeroForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = 'Enter a headline.';
  if (f.title.trim().length > 160) e.title = 'Keep the headline under 160 characters.';
  if (f.body.trim().length > 600) e.body = 'Keep the text under 600 characters.';
  if (!f.primaryLabel.trim()) e.primaryLabel = 'Enter a button label.';
  if (!HERO_URL_OK(f.primaryUrl.trim())) e.primaryUrl = 'Start with / or https://.';
  if (!f.secondaryLabel.trim()) e.secondaryLabel = 'Enter a button label.';
  if (!HERO_URL_OK(f.secondaryUrl.trim())) e.secondaryUrl = 'Start with / or https://.';
  if (!f.imageSrc.trim()) e.imageSrc = 'Upload an image or paste its URL.';
  return e;
}

/** Menu link rule (server: routes/admin/menus.ts `isMenuUrl`). */
export const MENU_URL_OK = (s: string) => /^\/(?!\/)/.test(s) || /^https?:\/\/\S+$/i.test(s) || /^mailto:\S+$/i.test(s);
