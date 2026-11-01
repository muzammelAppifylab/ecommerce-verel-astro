import {Hono, type Context} from 'hono';
import {z} from 'zod';

import {fileUrl} from '../../platform/files';
import {withDb, withViewer} from '../../platform/guards';
import {normEmail} from '../lib/format';
import {apiError} from '../lib/http';
import {normalizeOrderNumber, ownedBy} from '../lib/orders';
import {query} from '../lib/validate';

/**
 * Digital downloads (WP-13, PLAN.md §5, D8). Port of VAREL worker/routes/downloads.ts.
 *
 *   GET /site-api/downloads/:file[?order=&email=][&format=json]
 *
 * A file is downloadable by whoever owns a PAID order holding a digital line with that `download`: signed in
 * (an order linked to the account, or a guest order with the account's email), or a guest with the order
 * number + the order's email (the confirmation page and emails build those links).
 *
 * VAREL streamed the file from R2. Here files are private platform files (`file_<26>` ids in
 * `products.download` / `shop_order_items.download`): the answer is a 302 to a 5-minute signed link, or
 * `{url, expiresAt}` with `?format=json` (the account app asks through `siteFetch`, which keeps the session in
 * the editor Preview, then navigates). Older bare names (`varel-care-guide.pdf`, the seed) are not platform
 * files: they answer 404 `download_unavailable`.
 */

/** A safe download value in the URL (VAREL rule): word characters, dots and dashes, not starting with a dot. */
export const fileParam = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.-]+$/)
  .refine(s => !s.startsWith('.'));

/** A platform file id (src/platform/files.ts). */
export const PLATFORM_FILE_ID = /^file_[0-9a-z]{26}$/;
export const isPlatformFileId = (v: string) => PLATFORM_FILE_ID.test(v);

export const downloadQuery = z.object({
  order: z.string().trim().max(20).optional(),
  email: z.string().trim().max(254).optional(),
  format: z.enum(['json']).optional(),
});

/** JSON when asked (`?format=json`, or an Accept header that wants JSON and not a page). */
export function wantsJson(format: string | undefined, accept: string | null | undefined): boolean {
  if (format === 'json') return true;
  const a = (accept ?? '').toLowerCase();
  return a.includes('application/json') && !a.includes('text/html');
}

const PRIVATE_HEADERS = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'};

function answer(c: Context, status: 403 | 404 | 503, code: string, message: string) {
  const res = apiError(c, status, code, message);
  for (const [k, v] of Object.entries(PRIVATE_HEADERS)) res.headers.set(k, v);
  return res;
}

const notFound = (c: Context) => answer(c, 404, 'not_found', 'We cannot find that download');
const unavailable = (c: Context, status: 404 | 503 = 404) =>
  status === 404
    ? answer(c, 404, 'download_unavailable', 'This file is not available yet. Contact the studio and we will send it.')
    : answer(c, 503, 'download_unavailable', 'Downloads are not available right now. Try again in a moment.');

/** Mounted at `/site-api/downloads` (src/server/app.ts). */
export const downloadRoutes = new Hono().get('/:file', query(downloadQuery), withViewer, withDb, async c => {
  const file = c.req.param('file');
  if (!fileParam.safeParse(file).success) return notFound(c);
  const {order, email, format} = c.req.valid('query');
  const db = c.var.db;
  const viewer = c.var.viewer;

  let allowed = false;
  if (viewer.state === 'user' && viewer.id != null) {
    const me = {id: viewer.id, email: normEmail(viewer.email ?? '')};
    const hit = await db.shopOrderItem.findFirst({
      where: {digital: true, download: file, order: {AND: [{payment: 'Paid'}, ownedBy(me)]}},
      select: {id: true},
    });
    allowed = !!hit;
  }
  if (!allowed && order && email) {
    const o = await db.shopOrder.findUnique({
      where: {number: normalizeOrderNumber(order)},
      select: {id: true, email: true, payment: true},
    });
    if (o && o.payment === 'Paid' && normEmail(o.email) === normEmail(email)) {
      const hit = await db.shopOrderItem.findFirst({
        where: {orderId: o.id, digital: true, download: file},
        select: {id: true},
      });
      allowed = !!hit;
    }
  }
  if (!allowed) {
    return answer(c, 403, 'download_forbidden', 'Sign in, or open the link from your order, to download this file');
  }

  if (!isPlatformFileId(file)) return unavailable(c);
  let link: Awaited<ReturnType<typeof fileUrl>>;
  try {
    link = await fileUrl(c.req.url, file, {expiresIn: 300, download: true});
  } catch {
    // No Site Key (storage not set up) or a malformed id.
    return unavailable(c, 503);
  }
  if (!link.ok) return unavailable(c, link.status === 404 ? 404 : 503);

  if (wantsJson(format, c.req.header('accept'))) {
    const res = c.json({url: link.data.url, expiresAt: link.data.expiresAt});
    for (const [k, v] of Object.entries(PRIVATE_HEADERS)) res.headers.set(k, v);
    return res;
  }
  return new Response(null, {status: 302, headers: {Location: link.data.url, ...PRIVATE_HEADERS}});
});
