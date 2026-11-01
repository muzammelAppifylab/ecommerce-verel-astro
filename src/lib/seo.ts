import {SITE} from '../content/site';
import {config} from '../platform/config';
import {INTL_LOCALE} from './i18n/locales';

/**
 * SERVER / BUILD TIME: the site's public origin (`https://www.example.com`,
 * no trailing slash) for canonical URLs, social cards, the sitemap, robots.txt
 * and RSS. `SITE.url` when the owner set it (a custom domain), else the
 * address the platform gives the site (`config.siteUrl`, also set while a Publish
 * PRERENDERS pages). '' in `npm run dev` and the editor Preview, whose address
 * is not the site's: pages then leave absolute URLs out.
 */
export function siteOrigin(): string {
  if (import.meta.env.DEV || config.preview) return SITE.url.replace(/\/+$/, '');
  const origin = (SITE.url || config.siteUrl || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/.test(origin) ? origin : '';
}

/** `path` (or an https URL) as an absolute URL; null when the origin is not known. */
export function absoluteUrl(path: string): string | null {
  if (/^https:\/\//.test(path)) return path;
  const origin = siteOrigin();
  return origin ? new URL(path, `${origin}/`).href : null;
}

/** Escape a value for XML text or an attribute (sitemap, RSS). */
export const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Structured data (schema.org JSON-LD) for search engines. `<Base>` renders it
 * as `<script type="application/ld+json">`: a data block, never executed, so
 * the CSP does not apply to it. Only facts the page itself shows; absolute
 * URLs only when the site's address is known (`siteOrigin()`).
 */
export type JsonLd = Record<string, unknown>;

/** JSON safe inside `<script>` (no `</script>`, no `<!--`): the ONLY way to render JSON-LD. */
export function jsonLdText(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

const organizationId = () => {
  const origin = siteOrigin();
  return origin ? `${origin}/#organization` : null;
};

/** The site as an `Organization` (name, address, logo): the publisher of posts and the hiring org of jobs. */
function organization(site: SiteIdentity): JsonLd {
  const id = organizationId();
  const url = absoluteUrl('/');
  const logo = site.logo && !site.logo.startsWith('//') ? absoluteUrl(site.logo) : null;
  // Only the store's own social profiles (https), as the footer links them.
  const sameAs = [...new Set((site.sameAs ?? []).filter(link => /^https:\/\/[^\s"<>]+$/i.test(link)))];
  const email = site.email?.trim();
  const telephone = site.telephone?.trim();
  const legalName = site.legalName?.trim();
  return {
    '@type': 'Organization',
    ...(id && {'@id': id}),
    name: site.name,
    ...(legalName && legalName !== site.name && {legalName}),
    ...(url && {url}),
    ...(logo && {logo}),
    ...(email && {email}),
    ...(telephone && {telephone}),
    ...(sameAs.length && {sameAs}),
  };
}

/** Who the site is, for the home page's `Organization` (the storefront adds the store's settings). */
export interface SiteIdentity {
  name: string;
  logo?: string | null;
  /** Social profile URLs (Instagram, Pinterest…). */
  sameAs?: string[];
  email?: string | null;
  telephone?: string | null;
  legalName?: string | null;
}

/** The home page's `WebSite` + `Organization` (the site name in search results). */
export function siteJsonLd(site: SiteIdentity, description: string, lang: string): JsonLd {
  const origin = siteOrigin();
  const url = absoluteUrl('/');
  const id = organizationId();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        ...(origin && {'@id': `${origin}/#website`}),
        name: site.name,
        description,
        inLanguage: lang,
        ...(url && {url}),
        ...(id && {publisher: {'@id': id}}),
      },
      organization(site),
    ],
  };
}

/** A blog post's `BlogPosting`, from its front matter. */
export function postJsonLd(
  site: {name: string; logo?: string | null},
  post: {path: string; title: string; description: string; publishedAt: Date; updatedAt?: Date; author?: string; image?: string | null}
): JsonLd {
  const url = absoluteUrl(post.path);
  const image = post.image ? absoluteUrl(post.image) : null;
  const publisher = organization(site);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt.toISOString(),
    dateModified: (post.updatedAt ?? post.publishedAt).toISOString(),
    author: post.author ? {'@type': 'Person', name: post.author} : publisher,
    publisher,
    ...(url && {url, mainEntityOfPage: url}),
    ...(image && {image}),
  };
}

/** One step of a breadcrumb trail as the page shows it: the last one (the page itself) usually has no `href`. */
export interface Crumb {
  label: string;
  href?: string | null;
}

/**
 * schema.org `BreadcrumbList` from the trail the page SHOWS (home › shop › dept › category › product).
 * Each step's `item` is its absolute URL; the last step without an `href` is the page itself (`current`, its
 * canonical path). Null when the site's address is not known (dev, Preview) or the trail is under two steps:
 * Google needs absolute URLs.
 */
export function breadcrumbJsonLd(trail: readonly Crumb[], current?: string | null): JsonLd | null {
  if (!siteOrigin() || trail.length < 2) return null;
  const itemListElement = trail.map((crumb, index) => {
    const path = crumb.href ?? (index === trail.length - 1 ? current : null);
    const item = path ? absoluteUrl(path.split(/[?#]/)[0]) : null;
    return {'@type': 'ListItem', position: index + 1, name: crumb.label, ...(item && {item})};
  });
  return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement};
}

/** `og:locale` form of a language code (VAREL html.ts `ogLocale`): `da` → `da_DK`, `pt-BR` → `pt_BR`. */
export function ogLocale(code: string): string {
  const [lang = '', region] = code.trim().split(/[-_]/);
  if (region) return `${lang.toLowerCase()}_${region.toUpperCase()}`;
  return (INTL_LOCALE[lang.toLowerCase()] ?? lang.toLowerCase()).replace('-', '_');
}
