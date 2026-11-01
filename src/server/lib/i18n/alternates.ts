/* Language alternates for the sitemap (port of VAREL worker/routes/html.ts `alternatesFor`, with D7 path prefixes
   instead of `?lang=xx`). Pure: `src/pages/sitemap.xml.ts` passes the store's languages and an absolute-URL maker.
   Only languages the storefront can route at their own address are listed (F4 `PREFIXED_LOCALES` + the default),
   so an alternate never points at a 404. `x-default` is the bare (default-language) path. */
import {localizeHref} from '../../../components/varel/href';
import {DEFAULT_LOCALE, HREFLANG, PREFIXED_LOCALES} from '../../../lib/i18n/locales';
import {xmlEscape} from '../../../lib/seo';

/** The enabled languages that have their own address, default first. */
export function routableLocales(locales: readonly string[] | null | undefined): string[] {
  const ok = new Set([DEFAULT_LOCALE, ...PREFIXED_LOCALES]);
  const list = (locales ?? []).filter(l => ok.has(l));
  return [...new Set(list.includes(DEFAULT_LOCALE) ? [DEFAULT_LOCALE, ...list] : list)];
}

/** `<xhtml:link rel="alternate" …/>` lines for one sitemap path; none when fewer than two languages. */
export function sitemapAlternates(path: string, locales: readonly string[], absolute: (path: string) => string | null): string[] {
  if (locales.length < 2) return [];
  const links: string[] = [];
  for (const l of locales) {
    const href = absolute(localizeHref(l, path));
    if (href) links.push(`<xhtml:link rel="alternate" hreflang="${xmlEscape(HREFLANG[l] ?? l)}" href="${xmlEscape(href)}"/>`);
  }
  const fallback = absolute(localizeHref(DEFAULT_LOCALE, path));
  if (fallback && links.length) links.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(fallback)}"/>`);
  return links;
}
