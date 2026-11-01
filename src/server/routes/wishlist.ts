import {type Context, Hono} from 'hono';
import {z} from 'zod';

import type {WishlistMoveResponse, WishlistResponse} from '../../components/wishlist/api';
import type {WishlistIds} from '../../lib/types/cart';
import {withDb, withViewer} from '../../platform/guards';
import {
  BAG_LINE_LIMIT,
  getOrCreateCart,
  type Owner,
  ownerOf,
  pickVariant,
  reloadCart,
  serializeCart,
  viewerUserId,
} from '../lib/cart';
import type {Db} from '../lib/db';
import {notFound} from '../lib/errors';
import {apiError} from '../lib/http';
import {loadCatalogTr, locOf} from '../lib/i18n/localize';
import {loadProductPromotions} from '../lib/promotions-loader';
import {productSelect, serializeProduct} from '../lib/serializers';
import {getSettings} from '../lib/settings';
import {json} from '../lib/validate';
import {readVisitorId, withVisitor} from '../lib/visitor';

/**
 * Wishlist (WP-10). Port of VAREL worker/routes/wishlist.ts, mounted at `/site-api/wishlist`.
 *
 *   GET    /site-api/wishlist                 {items: Product[], ids}      the wishlist page
 *   GET    /site-api/wishlist/ids             {ids}                        header count + hearts (bag.sync)
 *   POST   /site-api/wishlist                 {productId} → {ids}          add (idempotent; ≤ 100 pieces)
 *   POST   /site-api/wishlist/move-to-bag     {productIds?} → {cart, ids}  first available variant, 1 each
 *   DELETE /site-api/wishlist/:productId      → {ids}                      remove (idempotent)
 *
 * Owner: the signed-in user (template viewer), else the guest `visitor_id` cookie (src/server/lib/visitor.ts).
 * Reads and deletes never create a visitor (no cookie → empty answer, no write); only adds and moves do.
 * Only published products are listed, counted or moved; oldest saved first everywhere.
 * Every answer is `private, no-store` (withViewer). Errors: `{error, message, fields?}` (app.onError).
 */

/** Most pieces one wishlist holds (bounded reads, AGENTS.md). */
export const WISHLIST_LIMIT = 100;
/** Most units of one variant a bag line holds (VAREL cart `qtyBody`). */
export const LINE_QTY_MAX = 99;

const productIdField = z
  .string({error: 'Choose a product'})
  .trim()
  .min(1, 'Choose a product')
  .max(120, 'Choose a product');

const addBody = z.object({productId: productIdField});
const moveBody = z.object({
  productIds: z.array(z.string().trim().min(1).max(120)).max(WISHLIST_LIMIT).optional(),
});

type OwnerWhere = {userId: number} | {visitorId: string};
const ownerWhere = (owner: Owner): OwnerWhere =>
  owner.userId != null ? {userId: owner.userId} : {visitorId: owner.visitorId!};

/** The request's owner WITHOUT creating anything: the signed-in user, else the visitor cookie, else null. */
function existingOwner(c: Context): Owner | null {
  const userId = viewerUserId(c);
  if (userId != null) return {userId};
  const visitorId = readVisitorId(c);
  return visitorId ? {visitorId} : null;
}

const dbOf = (c: Context) => (c.get as (name: string) => unknown)('db') as Db;

const listOrder = [{createdAt: 'asc' as const}, {id: 'asc' as const}];

/** Published product ids on the owner's wishlist, oldest first (at most `take`). */
export async function publishedIds(db: Db, owner: Owner, take = WISHLIST_LIMIT): Promise<string[]> {
  const rows = await db.wishlistItem.findMany({
    where: {...ownerWhere(owner), product: {status: 'published'}},
    orderBy: listOrder,
    take,
    select: {productId: true},
  });
  return rows.map(r => r.productId);
}

// ─── Move to bag (pure planner, unit-tested) ────────────────────────────────

export interface MoveCandidate {
  /** wishlist_items.id */
  id: number;
  productId: string;
  product: {
    allowBackorder: boolean;
    variants: Array<{id: string; color: string | null; size: string | null; inventory: number | null}>;
  };
}

export interface ExistingLine {
  id: number;
  variantId: string;
  qty: number;
}

export interface MovePlan {
  creates: Array<{productId: string; variantId: string; qty: number}>;
  updates: Array<{lineId: number; qty: number}>;
  /** wishlist_items ids to delete: the pieces that went into the bag */
  moved: number[];
}

/**
 * What "Add all in stock" does (VAREL move-to-bag): for each piece, oldest first, the first available variant
 * (`pickVariant`), one unit, merged into an existing line of that variant. Skipped (stays on the wishlist):
 * no variant, a variant at zero stock (VAREL parity, even for backorder products), a line already at the
 * stock limit (VAREL `assertStock` 409) or at 99 units, or a new line when the bag already holds `lineLimit`
 * distinct lines (F4 `addLine` BAG_FULL).
 */
export function planMove(items: MoveCandidate[], lines: ExistingLine[], lineLimit = BAG_LINE_LIMIT): MovePlan {
  const byVariant = new Map(lines.map(l => [l.variantId, l]));
  const plan: MovePlan = {creates: [], updates: [], moved: []};
  let lineCount = lines.length;
  for (const item of items) {
    const v = pickVariant(item.product.variants);
    if (!v || (v.inventory != null && v.inventory <= 0)) continue;
    const existing = byVariant.get(v.id);
    const next = (existing?.qty ?? 0) + 1;
    if (!item.product.allowBackorder && v.inventory != null && next > v.inventory) continue;
    if (next > LINE_QTY_MAX) continue;
    if (existing) {
      plan.updates.push({lineId: existing.id, qty: next});
    } else {
      if (lineCount >= lineLimit) continue;
      plan.creates.push({productId: item.productId, variantId: v.id, qty: next});
      lineCount += 1;
    }
    // One wishlist row per product, and a variant belongs to one product: no variant is planned twice.
    plan.moved.push(item.id);
  }
  return plan;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/** Mounted at `/site-api/wishlist` (src/server/app.ts). Static paths stay before `/:productId`. */
export const wishlistRoutes = new Hono()
  .get('/', withViewer, withDb, async c => {
    const owner = existingOwner(c);
    if (!owner) return c.json<WishlistResponse>({items: [], ids: []});
    const db = dbOf(c);
    const loc = await locOf(c);
    const [rows, settings, promos] = await Promise.all([
      db.wishlistItem.findMany({
        where: {...ownerWhere(owner), product: {status: 'published'}},
        orderBy: listOrder,
        take: WISHLIST_LIMIT,
        select: {product: {select: productSelect}},
      }),
      getSettings(db),
      loadProductPromotions(db, undefined, loc),
    ]);
    const products = rows.map(r => r.product);
    const ctr = await loadCatalogTr(db, loc, products);
    const items = products.map(p => serializeProduct(p, settings.lowStockThreshold, promos, loc, ctr));
    return c.json<WishlistResponse>({items, ids: items.map(p => p.id)});
  })

  .get('/ids', withViewer, withDb, async c => {
    const owner = existingOwner(c);
    if (!owner) return c.json<WishlistIds>({ids: []});
    return c.json<WishlistIds>({ids: await publishedIds(dbOf(c), owner)});
  })

  .post('/', json(addBody), withViewer, withVisitor, withDb, async c => {
    const {productId} = c.req.valid('json');
    const db = dbOf(c);
    const product = await db.product.findUnique({where: {id: productId}, select: {id: true, status: true}});
    if (!product || product.status !== 'published') throw notFound('We cannot find that product');
    const owner = await ownerOf(c);
    // At most WISHLIST_LIMIT published pieces; re-adding one already there is fine.
    const ids = await publishedIds(db, owner, WISHLIST_LIMIT + 1);
    const already = ids.includes(productId);
    if (!already && ids.length >= WISHLIST_LIMIT) {
      return apiError(c, 409, 'wishlist_full', 'Your wishlist holds up to 100 pieces. Remove one to save another');
    }
    if (owner.userId != null) {
      await db.wishlistItem.upsert({
        where: {userId_productId: {userId: owner.userId, productId}},
        create: {userId: owner.userId, productId},
        update: {},
        select: {id: true},
      });
    } else {
      await db.wishlistItem.upsert({
        where: {visitorId_productId: {visitorId: owner.visitorId!, productId}},
        create: {visitorId: owner.visitorId!, productId},
        update: {},
        select: {id: true},
      });
    }
    return c.json<WishlistIds>({ids: already ? ids : [...ids, productId]});
  })

  .post('/move-to-bag', json(moveBody), withViewer, withVisitor, withDb, async c => {
    const {productIds} = c.req.valid('json');
    const db = dbOf(c);
    const owner = await ownerOf(c);
    const where = ownerWhere(owner);
    const [items, cart, loc] = await Promise.all([
      productIds && productIds.length === 0
        ? Promise.resolve([] as MoveCandidate[])
        : db.wishlistItem.findMany({
            where: {...where, product: {status: 'published'}, ...(productIds ? {productId: {in: productIds}} : {})},
            orderBy: listOrder,
            take: WISHLIST_LIMIT,
            select: {
              id: true,
              productId: true,
              product: {
                select: {
                  allowBackorder: true,
                  variants: {orderBy: {position: 'asc'}, take: 100, select: {id: true, color: true, size: true, inventory: true}},
                },
              },
            },
          }),
      getOrCreateCart(db, owner),
      locOf(c),
    ]);
    const plan = planMove(
      items,
      cart.lines.map(l => ({id: l.id, variantId: l.variantId, qty: l.qty}))
    );
    if (plan.moved.length) {
      // One batch (VAREL ran addLine per piece in an interactive transaction). Stock is re-checked at checkout.
      await db.$transaction([
        ...plan.creates.map(l =>
          db.cartLine.create({
            data: {cartId: cart.id, productId: l.productId, variantId: l.variantId, qty: l.qty},
            select: {id: true},
          })
        ),
        ...plan.updates.map(u => db.cartLine.update({where: {id: u.lineId}, data: {qty: u.qty}, select: {id: true}})),
        db.wishlistItem.deleteMany({where: {id: {in: plan.moved}, ...where}}),
      ]);
    }
    const [fresh, ids] = await Promise.all([
      plan.moved.length ? reloadCart(db, cart.id) : Promise.resolve(cart),
      publishedIds(db, owner),
    ]);
    return c.json<WishlistMoveResponse>({cart: await serializeCart(db, fresh, 0, null, loc), ids});
  })

  .delete('/:productId', withViewer, withDb, async c => {
    const owner = existingOwner(c);
    if (!owner) return c.json<WishlistIds>({ids: []});
    const db = dbOf(c);
    const productId = c.req.param('productId').trim();
    if (productId && productId.length <= 120) {
      await db.wishlistItem.deleteMany({where: {productId, ...ownerWhere(owner)}});
    }
    return c.json<WishlistIds>({ids: await publishedIds(db, owner)});
  });
