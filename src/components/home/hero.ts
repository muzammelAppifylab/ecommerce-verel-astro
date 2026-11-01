/*
 * The home hero's content rules (port of VAREL src/pages/home/HomeHero.tsx `DEFAULT_HERO` / `resolveHero`).
 * Framework-neutral on purpose (no React, Tailwind or DOM): the storefront hero (HomeHero.tsx) and the
 * dashboard's hero editor (WP-07, admin > Navigation) both import it.
 */
import type {Photo} from '../../lib/types/common';
import type {HomeHero} from '../../lib/types/settings';
import {HOME_PHOTOS} from './photos';

export interface HeroCta {
  label: string;
  url: string;
}

/** A hero with every field filled in (what the page renders). */
export interface ResolvedHero {
  eyebrow: string;
  title: string;
  body: string;
  primaryCta: HeroCta;
  secondaryCta: HeroCta;
  image: Photo;
}

/** The hero as designed (English); admin > Navigation > Home hero overrides any field (Setting.homeHero). */
export const DEFAULT_HERO: ResolvedHero = {
  eyebrow: 'Autumn 2026',
  title: 'Modern essentials.\nConsidered deeply.',
  body: 'Everyday pieces cut from natural materials in small runs, made to be worn well past the season.',
  primaryCta: {label: 'Shop women', url: '/shop/women'},
  secondaryCta: {label: 'Shop men', url: '/shop/men'},
  image: HOME_PHOTOS.hero,
};

/**
 * A link the hero may point at: a store path (`/…`, never `//…`), a web address or a mail link.
 * Anything else (`javascript:`, `data:`, protocol-relative) is refused. Added over VAREL (security).
 */
export function safeHref(url: string | null | undefined): boolean {
  const u = (url ?? '').trim();
  if (!u) return false;
  if (u.startsWith('/')) return !u.startsWith('//') && !u.startsWith('/\\');
  return /^(https?:\/\/[^\s/]|mailto:)/i.test(u);
}

/** An image source the hero may show: a site path or an https URL. */
const safeImage = (src: string | null | undefined): boolean => {
  const s = (src ?? '').trim();
  return !!s && ((s.startsWith('/') && !s.startsWith('//')) || /^https:\/\//i.test(s));
};

/** `home:hero.*` in the page language (the designed copy), keeping the designed links and image. */
export function heroDefaults(t: (key: string) => string): ResolvedHero {
  return {
    ...DEFAULT_HERO,
    eyebrow: t('hero.eyebrow'),
    title: t('hero.title'),
    body: t('hero.body'),
    primaryCta: {...DEFAULT_HERO.primaryCta, label: t('hero.primaryCta')},
    secondaryCta: {...DEFAULT_HERO.secondaryCta, label: t('hero.secondaryCta')},
  };
}

/** Each field of the stored hero, falling back to the designed copy (`d`). */
export function resolveHero(h: HomeHero | undefined | null, d: ResolvedHero = DEFAULT_HERO): ResolvedHero {
  const cta = (c: HomeHero['primaryCta'], fallback: HeroCta): HeroCta =>
    c && c.label?.trim() && c.url?.trim() && safeHref(c.url) ? c : fallback;
  return {
    eyebrow: h?.eyebrow?.trim() || d.eyebrow,
    title: h?.title?.trim() || d.title,
    body: h?.body?.trim() || d.body,
    primaryCta: cta(h?.primaryCta, d.primaryCta),
    secondaryCta: cta(h?.secondaryCta, d.secondaryCta),
    image: h?.image?.src && safeImage(h.image.src) ? h.image : d.image,
  };
}

/** Is this the designed studio photo (it gets the designed alt text and focal point)? */
export const isDefaultHeroImage = (image: Photo): boolean => image.src === DEFAULT_HERO.image.src;
