import {type QueryClient, queryOptions} from '@tanstack/react-query';

import type {AdminMenu, AdminMenuInput} from '../../lib/types/admin/content';
import type {StoreSettings} from '../../lib/types/admin/store';
import type {MenuKey} from '../../lib/types/content';
import type {HomeHero} from '../../lib/types/settings';
import {manage} from '../api';

/**
 * Menus and the home hero (`/dashboard/navigation`). WP-07 owns this file (`/site-api/manage/menus`).
 * Port of VAREL `src/lib/admin/cms.ts` (menus part) + the settings read/write the hero editor uses.
 */

export const navigationKeys = {
  menus: ['manage', 'menus'] as const,
  /** The store settings (`GET /site-api/manage/settings`, WP-23): the same key and shape as the settings screens. */
  settings: ['manage', 'settings'] as const,
};

/** The four menus, in display order (never stored ones are `stored: false`). */
export const menusQuery = queryOptions({
  queryKey: navigationKeys.menus,
  queryFn: ({signal}) => manage<AdminMenu[]>('menus', {signal}),
});

export const storeSettingsQuery = queryOptions({
  queryKey: navigationKeys.settings,
  queryFn: ({signal}) => manage<StoreSettings>('settings', {signal}),
});

export const saveMenu = ({key, ...body}: AdminMenuInput & {key: MenuKey}) => manage<AdminMenu>(`menus/${key}`, {method: 'PUT', body});

/** `{}` puts the designed hero back (every field falls back to it). */
export const saveHomeHero = (homeHero: HomeHero) => manage<StoreSettings>('settings', {method: 'PATCH', body: {homeHero}});

export const loadNavigation = (queryClient: QueryClient): Promise<void> =>
  Promise.all([queryClient.ensureQueryData(menusQuery), queryClient.ensureQueryData(storeSettingsQuery)]).then(() => undefined);
