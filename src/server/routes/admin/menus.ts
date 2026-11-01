import {Hono} from 'hono';
import {createMiddleware} from 'hono/factory';
import {z} from 'zod';

import type {AdminMenu} from '../../../lib/types/admin/content';
import type {MenuItem, MenuKey} from '../../../lib/types/content';
import {withDb} from '../../../platform/guards';
import {queueEntityTranslation} from '../../lib/contracts';
import {apiError} from '../../lib/http';
import {json} from '../../lib/validate';

/**
 * Admin: storefront navigation menus (header + three footer columns). WP-07 (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/menus.ts: VAREL `/api/admin/menus…` is `/site-api/manage/menus…` here.
 *
 *   GET    /site-api/manage/menus                      AdminMenu[] (always the 4 menus, in display order)
 *   PUT    /site-api/manage/menus/:key                 AdminMenuInput → AdminMenu
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: content), then the activity log. Admin routes never localize: they read and save the
 * source text (translations are queued after a save).
 */

/** The menus the storefront reads, in display order, with the title used when none is stored yet. */
export const MENU_KEYS = [
  {key: 'header', title: 'Header'},
  {key: 'footer-studio', title: 'Menu'},
  {key: 'footer-shop', title: 'Shop'},
  {key: 'footer-help', title: 'Account'},
] as const satisfies readonly {key: MenuKey; title: string}[];

export const MENU_ITEM_LIMIT = 20;

/** Menu items stored as JSON; anything malformed is dropped (VAREL routes/pages.ts `menuItems`). */
export function menuItems(raw: unknown): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is MenuItem => !!i && typeof i === 'object' && typeof (i as MenuItem).label === 'string' && typeof (i as MenuItem).url === 'string')
    .map(i => ({label: i.label, url: i.url}));
}

/** A store path (`/x`, never `//host`), a full http(s) link or a mailto: link. */
export const isMenuUrl = (s: string) => /^\/(?!\/)/.test(s) || /^https?:\/\/[^\s]+$/i.test(s) || /^mailto:[^\s]+$/i.test(s);

const url = z
  .string({error: 'Enter a link'})
  .trim()
  .min(1, 'Enter a link')
  .max(500, 'Keep the link under 500 characters')
  .refine(isMenuUrl, 'Start with / for a store page, or use a full https:// link');

export const menuSchema = z.object({
  title: z.string({error: 'Enter a title'}).trim().min(1, 'Enter a title').max(60, 'Keep the title under 60 characters'),
  items: z
    .array(
      z.object({
        label: z.string({error: 'Enter a label'}).trim().min(1, 'Enter a label').max(60, 'Keep the label under 60 characters'),
        url,
      }),
      {error: 'Add the menu links'}
    )
    .max(MENU_ITEM_LIMIT, 'Keep a menu to 20 links or fewer'),
});

/** Unknown menu keys are a 404 before the body is read (VAREL checked the key first). */
const knownKey = createMiddleware(async (c, next) => {
  if (!MENU_KEYS.some(m => m.key === c.req.param('key'))) return apiError(c, 404, 'not_found', 'We cannot find that menu');
  await next();
});

const menuSelect = {id: true, key: true, title: true, items: true, updatedAt: true} as const;

export const menusAdmin = new Hono()
  .get('/', withDb, async c => {
    const rows = await c.var.db.menu.findMany({
      where: {key: {in: MENU_KEYS.map(m => m.key)}},
      select: menuSelect,
      take: MENU_KEYS.length,
    });
    const out: AdminMenu[] = MENU_KEYS.map(({key, title}) => {
      const m = rows.find(r => r.key === key);
      return m
        ? {id: String(m.id), key, title: m.title, items: menuItems(m.items), stored: true, updatedAt: m.updatedAt.toISOString()}
        : {id: null, key, title, items: [], stored: false, updatedAt: null};
    });
    return c.json(out);
  })
  .put('/:key', knownKey, json(menuSchema), withDb, async c => {
    const key = MENU_KEYS.find(m => m.key === c.req.param('key'))?.key;
    if (!key) return apiError(c, 404, 'not_found', 'We cannot find that menu');
    const input = c.req.valid('json');
    const m = await c.var.db.menu.upsert({
      where: {key},
      create: {key, title: input.title, items: input.items},
      update: {title: input.title, items: input.items},
      select: menuSelect,
    });
    await queueEntityTranslation(c.var.db, 'menu', String(m.id), {requestUrl: c.req.url});
    const out: AdminMenu = {id: String(m.id), key, title: m.title, items: menuItems(m.items), stored: true, updatedAt: m.updatedAt.toISOString()};
    return c.json(out);
  });
