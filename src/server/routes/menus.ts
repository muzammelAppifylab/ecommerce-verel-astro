import {Hono} from 'hono';

import type {Menu, MenuItem, MenuKey} from '../../lib/types/content';
import {withDb} from '../../platform/guards';
import {loadFor, makeLoc, type TranslationMap, trJson} from '../lib/i18n/localize';
import {localeOf, localeSettings, withLocale} from '../lib/locale';
import {cacheByLocale} from './settings';

/**
 * Navigation menus (public). WP-01. Port of VAREL worker/routes/pages.ts (`menuItems`, GET /menus).
 *
 *   GET    /site-api/menus                             Menu[] (src/lib/types/content.ts), localized
 *
 * Public, visitor-independent; input: only `lang` (through `localeOf`). Guards: withDb → withLocale.
 * Labels come in the request language (entity `menu`, field `items`); URLs and titles stay the source's.
 */

/** Menus are few (4 in the seed, keys are unique); items per menu are capped. */
export const MENU_LIMIT = 20;
export const MENU_ITEM_LIMIT = 20;

/** Store paths (`/…`, not `//…`), web links, mail and phone links. Anything else (`javascript:`, `data:`) is dropped. */
export const safeMenuUrl = (url: string): boolean =>
  (url.startsWith('/') && !url.startsWith('//')) || /^(https?:\/\/|mailto:|tel:)/i.test(url);

/** Menu items stored as JSON; anything malformed (or with an unsafe URL) is dropped. */
export function menuItems(raw: unknown): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MenuItem[] = [];
  for (const i of raw) {
    if (!i || typeof i !== 'object') continue;
    const {label, url} = i as Record<string, unknown>;
    if (typeof label !== 'string' || typeof url !== 'string') continue;
    const u = url.trim();
    if (!safeMenuUrl(u)) continue;
    out.push({label: label.trim(), url: u});
    if (out.length >= MENU_ITEM_LIMIT) break;
  }
  return out;
}

/** Source items with translated labels: matched by URL, else by position when both lists have the same length. */
export function translateItems(items: MenuItem[], translated: MenuItem[]): MenuItem[] {
  return items.map((it, i) => {
    const t = translated.find(x => x.url === it.url) ?? (translated.length === items.length ? translated[i] : undefined);
    return t ? {label: t.label, url: it.url} : it;
  });
}

interface MenuRow {
  id: number;
  key: string;
  title: string;
  items: unknown;
}

/** Rows → wire, overlaying `tmap` (the `menu` translations of the request language). Titles are never translated. */
export function serializeMenus(rows: MenuRow[], tmap: TranslationMap): Menu[] {
  return rows.map(m => {
    const items = menuItems(m.items);
    const translated = menuItems(trJson<unknown>(tmap, String(m.id), 'items', null));
    return {key: m.key as MenuKey, title: m.title, items: translateItems(items, translated)};
  });
}

/** Mounted at `/site-api/menus` (src/server/app.ts). */
export const menuRoutes = new Hono().get('/', withDb, withLocale, async c => {
  const db = c.var.db;
  const [rows, {defaultLocale}, locale] = await Promise.all([
    db.menu.findMany({
      select: {id: true, key: true, title: true, items: true},
      orderBy: {key: 'asc'},
      take: MENU_LIMIT,
    }),
    localeSettings(db),
    localeOf(c),
  ]);
  const tmap = await loadFor(
    db,
    makeLoc(locale, defaultLocale),
    'menu',
    rows.map(m => String(m.id)),
    ['items']
  );
  await cacheByLocale(c, db);
  return c.json(serializeMenus(rows, tmap));
});
