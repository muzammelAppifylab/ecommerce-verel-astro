/*
 * SERVER ONLY: the 404 page's product picks ("In the studio now"): `GET /site-api/products?tag=new&limit=4`
 * (WP-02) in-process. Null when the read fails or the route is not there yet: the section is then hidden
 * (VAREL hid it on error or with no items).
 */
import {read} from '@/server/backend';
import type {backend} from '@/server/backend';

import type {NotFoundPick} from './NotFoundView';

type Api = ReturnType<typeof backend>;

export async function notFoundPicks(api: Api): Promise<NotFoundPick[] | null> {
  const get = api.products.$get as unknown as (args: {query: Record<string, string>}) => Promise<Response>;
  const data = await read<{items?: NotFoundPick[]}>(get({query: {tag: 'new', limit: '4'}}));
  return Array.isArray(data?.items) ? data.items.slice(0, 4) : null;
}
