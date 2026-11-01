/* Link targets (port of VAREL src/lib/links.ts, PLAN.md D13).
   VAREL built typed TanStack Router destinations; the storefront here is real pages, so these return hrefs:
   VAREL paths with a trailing slash, prefixed with the language when one is given (`/da/product/x/`).
   Plain `<a href>` everywhere on public pages (AGENTS.md); the account app (`/account/*`) uses its own router. */
import {localizedPath} from './i18n/locales';
import {slugify} from './format';

type Search = Record<string, string | number | null | undefined>;

/** "/shop/" + optional query, in `locale` (the default language has no prefix). */
export function href(path: string, locale?: string | null, search?: Search): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(search ?? {})) if (v != null && v !== '') sp.set(k, String(v));
  const q = sp.toString();
  return `${localizedPath(path, locale)}${q ? `?${q}` : ''}`;
}

const seg = (s: string) => encodeURIComponent(s);

export const homeLink = (locale?: string | null) => href('/', locale);
export const shopLink = (locale?: string | null) => href('/shop/', locale);
export const productLink = (slug: string, locale?: string | null) => href(`/product/${seg(slug)}/`, locale);
export const postLink = (slug: string, locale?: string | null) => href(`/journal/${seg(slug)}/`, locale);
export const journalLink = (locale?: string | null) => href('/journal/', locale);
export const journalCategoryLink = (name: string, locale?: string | null) =>
  href(`/journal/category/${seg(slugify(name))}/`, locale);
export const deptLink = (dept: string, locale?: string | null) => href(`/shop/${seg(dept)}/`, locale);
export const categoryLink = (dept: string, category: string, locale?: string | null) =>
  href(`/shop/${seg(dept)}/${seg(category)}/`, locale);
export const collectionsLink = (locale?: string | null) => href('/collections/', locale);
export const collectionLink = (slug: string, locale?: string | null) => href(`/collections/${seg(slug)}/`, locale);
export const cmsPageLink = (slug: string, locale?: string | null) => href(`/pages/${seg(slug)}/`, locale);
export const cartLink = (locale?: string | null) => href('/cart/', locale);
export const checkoutLink = (locale?: string | null) => href('/checkout/', locale);
export const wishlistLink = (locale?: string | null) => href('/wishlist/', locale);
export const confirmationLink = (number: string, locale?: string | null) =>
  href(`/order/${seg(number)}/confirmation/`, locale);
export const accountLink = (locale?: string | null) => href('/account/', locale);
export const orderLink = (number: string, locale?: string | null) => href(`/account/orders/${seg(number)}/`, locale);
export const returnsLink = (order?: string | null, locale?: string | null) => href('/returns/', locale, {order});
export const searchLink = (q?: string | null, locale?: string | null) => href('/search/', locale, {q});
export const loginLink = (next?: string | null) => href('/account/login/', null, {next});
export const registerLink = (next?: string | null) => href('/account/register/', null, {next});
