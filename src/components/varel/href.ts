/*
 * Storefront URLs in the page language (decision D7, docs/migration/PLAN.md): English has no prefix, every other
 * language lives under `/<code>/` (`/da/shop/women/`), rewritten by src/middleware.ts. Public page URLs end
 * with `/` (AGENTS.md). VAREL paths kept in data (menus, settings) are mapped to this site's: `/login` →
 * `/account/login/`, `/signup` → `/account/register/`, `/admin` → `/dashboard`.
 */

export const DEFAULT_LOCALE = 'en';
export const SHIPPED_LOCALES = ['en', 'da', 'de', 'fr', 'es', 'sv'] as const;

/** VAREL routes that moved (D13). */
const MOVED: Record<string, string> = {
  '/login': '/account/login/',
  '/signup': '/account/register/',
  '/reset-password': '/account/forgot/',
  '/admin': '/dashboard',
};

/** True for links that leave the store (rendered as a plain new-tab <a>). */
export const isExternalUrl = (url: string) => /^(https?:|mailto:|tel:)/i.test(url);

/** Paths served by the dashboard or the API: never prefixed, never given a trailing slash. */
const unlocalized = (path: string) => /^\/(dashboard|portal|site-api|api)(\/|$)/.test(path) || /\.[a-z0-9]+$/i.test(path);

/** `/da/shop/` → `/shop/`: the path without a language prefix. */
export function stripLocale(pathname: string, locales: readonly string[] = SHIPPED_LOCALES): string {
  const m = /^\/([a-z]{2})(\/.*|$)/.exec(pathname);
  if (m && m[1] !== DEFAULT_LOCALE && locales.includes(m[1])) return m[2] || '/';
  return pathname;
}

/**
 * A store path for `locale`, with the trailing slash: `localizeHref('da', '/shop/women?sort=new')` →
 * `/da/shop/women/?sort=new`. External URLs, hashes and dashboard/API paths pass through unchanged.
 */
export function localizeHref(locale: string, href: string): string {
  if (!href || isExternalUrl(href) || href.startsWith('#') || href.startsWith('//')) return href;
  const u = new URL(href, 'https://store.local');
  let path = MOVED[u.pathname.replace(/\/$/, '') || '/'] ?? u.pathname;
  if (unlocalized(path)) return `${path}${u.search}${u.hash}`;
  path = stripLocale(path);
  if (!path.endsWith('/')) path = `${path}/`;
  const prefix = locale && locale !== DEFAULT_LOCALE ? `/${locale}` : '';
  return `${prefix}${path === '/' && prefix ? '/' : path}${u.search}${u.hash}`;
}

/** Is `href` (a store path) the page at `pathname` or one of its children? Used for the active department. */
export function isActivePath(pathname: string, href: string): boolean {
  if (isExternalUrl(href)) return false;
  const here = stripLocale(pathname).replace(/\/?$/, '/');
  const target = stripLocale(new URL(href, 'https://store.local').pathname).replace(/\/?$/, '/');
  return target === '/' ? here === '/' : here.startsWith(target);
}
