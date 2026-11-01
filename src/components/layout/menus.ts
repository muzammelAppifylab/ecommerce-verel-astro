/*
 * CMS-driven navigation (admin → Navigation), ported from VAREL `src/components/layout/menus.tsx` + `nav.ts`.
 * Each menu falls back to the built-in links below until menus exist or when a menu is empty. Resolved on the
 * server (labels translated, URLs localized) and handed to the islands as plain data.
 */
import {localizeHref} from '@/components/varel/href';

export type MenuKey = 'header' | 'footer-studio' | 'footer-shop' | 'footer-help';

export interface MenuItem {
  label: string;
  url: string;
}

export interface Menu {
  key: MenuKey;
  title: string;
  items: MenuItem[];
}

/** A menu entry ready to render: `href` is localized, `external` opens in a new tab (not for mailto:). */
export interface NavLink {
  label: string;
  href: string;
  external: boolean;
  /** The VAREL path it came from (`/login` is special in the footer: "Account" once signed in). */
  url: string;
}

export interface ResolvedMenu {
  key: MenuKey;
  title: string;
  items: NavLink[];
}

const DEPTS = ['Women', 'Men', 'Shoes', 'Bags'];
const dept = (d: string): MenuItem => ({label: d, url: `/shop/${d.toLowerCase()}`});

export const FALLBACK_MENUS: Record<MenuKey, Menu> = {
  header: {key: 'header', title: 'Header', items: [...DEPTS.map(dept), {label: 'Journal', url: '/journal'}]},
  'footer-studio': {
    key: 'footer-studio',
    title: 'Menu',
    items: [
      {label: 'About', url: '/about'},
      {label: 'Journal', url: '/journal'},
      {label: 'Contact', url: '/contact'},
      {label: 'All products', url: '/shop'},
    ],
  },
  'footer-shop': {key: 'footer-shop', title: 'Shop', items: DEPTS.map(dept)},
  'footer-help': {
    key: 'footer-help',
    title: 'Account',
    items: [
      {label: 'Bag', url: '/cart'},
      {label: 'Sign in', url: '/login'},
      {label: 'Orders', url: '/account/orders'},
      {label: 'Returns', url: '/returns'},
    ],
  },
};

/** The footer's three link columns, in order. */
export const FOOTER_MENU_KEYS = ['footer-studio', 'footer-shop', 'footer-help'] as const;

/** Built-in English labels → `layout:menu.labels.*`. Labels the server sends untranslated (or the fallback)
 *  show in the current language; labels an admin wrote or the server translated are shown as they are. */
const DEFAULT_LABELS: Record<string, string> = {
  Women: 'women',
  Men: 'men',
  Shoes: 'shoes',
  Bags: 'bags',
  Journal: 'journal',
  About: 'about',
  Contact: 'contact',
  'All products': 'allProducts',
  Bag: 'bag',
  'Sign in': 'signIn',
  Orders: 'orders',
  Returns: 'returns',
  Menu: 'menu',
  Shop: 'shop',
  Account: 'account',
};

const isExternal = (url: string) => /^(https?:|mailto:)/i.test(url);

/** Is this a menu list from GET /site-api/menus? (Anything else is ignored.) */
export function isMenuList(value: unknown): value is Menu[] {
  return (
    Array.isArray(value) &&
    value.every(
      m => m && typeof m === 'object' && typeof (m as Menu).key === 'string' && Array.isArray((m as Menu).items)
    )
  );
}

/** One menu: the CMS one when it has items, otherwise the fallback; labels translated, URLs localized. */
export function resolveMenu(
  menus: Menu[] | null,
  key: MenuKey,
  locale: string,
  t: (key: string) => string
): ResolvedMenu {
  const found = menus?.find(m => m.key === key);
  const menu = found && found.items.length ? found : FALLBACK_MENUS[key];
  const tr = (s: string) => (DEFAULT_LABELS[s] ? t(`menu.labels.${DEFAULT_LABELS[s]}`) : s);
  return {
    key,
    title: tr(menu.title),
    items: menu.items
      .filter(i => typeof i?.url === 'string' && typeof i?.label === 'string')
      .map(i => {
        const external = isExternal(i.url);
        return {
          label: tr(i.label),
          url: i.url,
          external: external && !i.url.toLowerCase().startsWith('mailto:'),
          href: external ? i.url : localizeHref(locale, i.url),
        };
      }),
  };
}
