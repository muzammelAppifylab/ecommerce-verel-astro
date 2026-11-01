import type {Context} from 'hono';
import {Hono} from 'hono';
import {z} from 'zod';

import {config} from '../../platform/config';
import {withDb, withViewer} from '../../platform/guards';
import type {Cart, Totals} from '../../lib/types/cart';
import {verifyRecoveryToken} from '../lib/abandoned';
import {
  addLine,
  assertStock,
  cartInclude,
  cartOf,
  getOrCreateCart,
  mergeGuestIntoUser,
  ownerOf,
  priceBag,
  reloadCart,
  serializeCart,
  viewerUserId,
  type CartRow,
} from '../lib/cart';
import type {Prisma} from '../../generated/prisma/client';
import type {Db, DbClient} from '../lib/db';
import {KEEPS_CODE} from '../lib/discounts';
import {HttpError, notFound} from '../lib/errors';
import {locOf} from '../lib/i18n/localize';
import {withLocale} from '../lib/locale';
import {fromCents} from '../lib/money';
import {zoneForCountry} from '../lib/shipping';
import {emailField, json, params, query} from '../lib/validate';
import {readVisitorId} from '../lib/visitor';
import {rateLimit} from '../lib/rate-limit';

/**
 * Bag (cart), discounts at the bag, abandoned-bag recovery (WP-09, docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/cart.ts + worker/routes/abandoned.ts (storefront part). VAREL `/api/<path>` is
 * `/site-api/<path>` here, same shapes (src/lib/types/cart.ts), errors as `{error, message, fields?}`.
 *
 *   GET    /site-api/cart                     Cart (guest: visitor cookie; signed in: the account). Read-only.
 *   GET    /site-api/cart/totals              Totals ?country&method&email (checkout). Read-only.
 *   POST   /site-api/cart/items               AddToCartInput → Cart (404 product, 422 variant, 409 stock / bag full)
 *   PATCH  /site-api/cart/items/:lineId       {qty} → Cart (0 removes; 409 over stock)
 *   DELETE /site-api/cart/items/:lineId       → Cart
 *   POST   /site-api/cart/discount            {code} + DiscountContext → Cart; 422 discount_* codes
 *   DELETE /site-api/cart/discount            → Cart
 *   POST   /site-api/cart/email               {email} → {email} (abandoned-bag reminders)
 *   GET    /site-api/cart/recover/:token      restore an abandoned bag from its reminder link → 302 /cart/
 *
 * Deviations from VAREL (docs/migration/handoff/WP-09.md):
 * - GETs never create anything: no cookie, no Visitor, no Cart until the first write (VAREL created a Session +
 *   Cart on every bag read). A visitor without a bag reads an empty bag with `id: ''`.
 * - Guest → account merge happens lazily here (template sign-in has no hook): a signed-in request that still
 *   carries a guest `visitor_id` with a bag or wishlist folds it into the account first.
 * - A bag holds at most 100 distinct lines (`BAG_FULL`, src/server/lib/cart.ts).
 * Every answer reads the visitor: `withViewer` sets `Cache-Control: private, no-store`.
 */

// ─── Input schemas (VAREL limits and copy) ─────────────────────────────────────

const addBody = z.object({
  productId: z.string({error: 'Choose a product'}).trim().min(1, 'Choose a product').max(120, 'Choose a product'),
  /** The exact variant (needed for products with custom options); colour + size still work for the others */
  variantId: z.string().trim().min(1).max(64).nullish(),
  color: z.string().trim().min(1).max(60).nullish(),
  size: z.string().trim().min(1).max(60).nullish(),
  qty: z.coerce
    .number({error: 'Use a whole number'})
    .int('Use a whole number')
    .min(1, 'Add at least one')
    .max(99, 'Add 99 or fewer')
    .default(1),
});

const qtyBody = z.object({
  qty: z.coerce
    .number({error: 'Enter a quantity'})
    .int('Use a whole number')
    .min(0, 'Use zero or more')
    .max(99, 'Add 99 or fewer'),
});

/** A line id from the URL: anything that is not a positive int4 is simply not in this bag (404, not 422). */
const lineParam = z.object({lineId: z.string()});
const LINE_ID = /^[1-9][0-9]{0,9}$/;
function lineIdOf(raw: string): number | null {
  if (!LINE_ID.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

const discountBody = z.object({
  code: z
    .string({error: 'Enter a code'})
    .trim()
    .min(1, 'Enter a code')
    .max(40, 'That code is too long')
    .transform(s => s.toUpperCase()),
  // Checkout context (optional): price free shipping at the selected rate and check the code for this email.
  country: z.string().trim().max(80).optional(),
  method: z.string().trim().max(80).optional(),
  email: z.string().trim().max(254).optional(),
});

const totalsQuery = z.object({
  country: z.string().trim().max(80).optional(),
  method: z.string().trim().max(80).optional(),
  /** Checkout email typed so far: customer-dependent offers (first order, per-customer limits…) are checked for it */
  email: z.string().trim().max(254).optional(),
});

const emailBody = z.object({email: emailField});

/** Recovery tokens are JWTs; anything longer is not one of ours (treated as invalid, never a 422). */
const tokenParam = z.object({token: z.string()});
const TOKEN_MAX = 2048;

// ─── Helpers ───────────────────────────────────────────────────────────────────

const dbOf = (c: Context) => (c.get as (name: string) => unknown)('db') as DbClient;

/** Rate of the chosen shipping method for a country (its first method when none is chosen), as checkout prices it. */
async function selectedRate(db: Db, country: string | undefined, method: string | undefined): Promise<number> {
  const zone = await zoneForCountry(db, country || 'Denmark');
  const chosen = zone.methods.find(m => m.id === method) ?? zone.methods[0];
  return chosen ? fromCents(chosen.rateCents) : 0;
}

/**
 * Guest → account (B4): a signed-in request still carrying a guest `visitor_id` whose visitor owns a bag or
 * wishlist rows folds them into the account (mergeGuestIntoUser clamps to stock, keeps the account's code,
 * deletes the guest bag, never throws). Two indexed point reads when there is nothing to merge.
 */
async function mergeGuestBag(c: Context, db: DbClient): Promise<void> {
  const userId = viewerUserId(c);
  const visitorId = readVisitorId(c);
  if (userId == null || !visitorId) return;
  const [cart, wish] = await Promise.all([
    db.cart.findUnique({where: {visitorId}, select: {id: true}}),
    db.wishlistItem.findFirst({where: {visitorId}, select: {id: true}}),
  ]);
  if (cart || wish) await mergeGuestIntoUser(db, visitorId, userId);
}

/** The request's bag without creating anything (GETs): the account's, else the guest cookie's, else null. */
async function readCart(c: Context, db: DbClient): Promise<{cart: CartRow | null; userId: number | null}> {
  await mergeGuestBag(c, db);
  const userId = viewerUserId(c);
  if (userId != null) return {cart: await db.cart.findUnique({where: {userId}, include: cartInclude}), userId};
  const visitorId = readVisitorId(c);
  return {cart: visitorId ? await db.cart.findUnique({where: {visitorId}, include: cartInclude}) : null, userId: null};
}

/** A bag that does not exist yet, priced like any other (real free-shipping threshold, tax name, labels). */
function emptyCart(userId: number | null): CartRow {
  const now = new Date();
  return {
    id: 0,
    userId,
    visitorId: null,
    discountCode: null,
    email: null,
    locale: null,
    reminderSentAt: null,
    dismissedAt: null,
    createdAt: now,
    updatedAt: now,
    lines: [],
  };
}

/** The request's bag for a write: merged first, then the owner's (created, with the guest cookie, when new). */
async function writableCart(c: Context, db: DbClient): Promise<CartRow> {
  await mergeGuestBag(c, db);
  return getOrCreateCart(db, await ownerOf(c));
}

async function answerCart(c: Context, db: DbClient, cartId: number): Promise<Cart> {
  return serializeCart(db, await reloadCart(db, cartId), 0, undefined, await locOf(c));
}

/** The line of this bag (draft products included, so a hidden line can still be removed); 404 otherwise. */
async function findLine(db: Db, cartId: number, rawLineId: string) {
  const id = lineIdOf(rawLineId);
  const line =
    id == null
      ? null
      : await db.cartLine.findFirst({
          where: {id, cartId},
          select: {
            id: true,
            qty: true,
            product: {select: {name: true, allowBackorder: true}},
            variant: {select: {id: true, inventory: true, color: true, size: true, options: true}},
          },
        });
  if (!line) throw notFound('That piece is no longer in your bag');
  return line;
}

type SourceLine = {
  productId: string;
  variantId: string;
  qty: number;
  product: {status: string};
  variant: {inventory: number | null};
};

const sourceSelect = {
  id: true,
  userId: true,
  visitorId: true,
  email: true,
  discountCode: true,
  lines: {
    orderBy: [{createdAt: 'asc'}, {id: 'asc'}] as Prisma.CartLineOrderByWithRelationInput[],
    take: 100,
    select: {
      productId: true,
      variantId: true,
      qty: true,
      product: {select: {status: true}},
      variant: {select: {inventory: true}},
    },
  },
} satisfies Prisma.CartSelect;

/** Put a line into a bag without doubling it: the larger of the two quantities, within stock. */
async function mergeLine(db: Db, cartId: number, l: SourceLine): Promise<void> {
  if (l.product.status !== 'published') return;
  const existing = await db.cartLine.findUnique({
    where: {cartId_variantId: {cartId, variantId: l.variantId}},
    select: {id: true, qty: true},
  });
  let qty = Math.max(existing?.qty ?? 0, l.qty);
  if (l.variant.inventory != null) qty = Math.min(qty, l.variant.inventory);
  if (qty <= 0) return;
  if (existing) {
    if (existing.qty !== qty) await db.cartLine.update({where: {id: existing.id}, data: {qty}});
  } else {
    await db.cartLine.create({data: {cartId, productId: l.productId, variantId: l.variantId, qty}});
  }
}

const toCartPage = (c: Context) => {
  c.header('Cache-Control', 'no-store');
  return c.redirect('/cart/', 302);
};

// ─── Routes ────────────────────────────────────────────────────────────────────

/** Mounted at `/site-api/cart` (src/server/app.ts). */
export const cartRoutes = new Hono()
  .get('/', withViewer, withDb, withLocale, async c => {
    const db = dbOf(c);
    const {cart, userId} = await readCart(c, db);
    const loc = await locOf(c);
    if (cart) return c.json(await serializeCart(db, cart, 0, undefined, loc));
    const empty = await serializeCart(db, emptyCart(userId), 0, undefined, loc);
    return c.json({...empty, id: ''} satisfies Cart);
  })

  .get('/totals', query(totalsQuery), withViewer, withDb, withLocale, async c => {
    const {country, method, email} = c.req.valid('query');
    const db = dbOf(c);
    const {cart: found, userId} = await readCart(c, db);
    const cart = found ?? emptyCart(userId);
    const shippingRate = await selectedRate(db, country, method);
    const priced = await priceBag(db, cart, {
      shippingRate,
      country: country || null,
      email: email || null,
      loc: await locOf(c),
    });
    const serialized = cartOf(cart, priced);
    // Line allocations and the stored code's status at this rate, so the checkout summary matches its totals.
    return c.json({
      ...serialized.totals,
      lineDiscounts: priced.result.lineDiscounts,
      discountError: serialized.discountError,
    } satisfies Totals);
  })

  .post('/items', json(addBody), withViewer, withDb, withLocale, async c => {
    const input = c.req.valid('json');
    const db = dbOf(c);
    const cart = await writableCart(c, db);
    await addLine(db, cart.id, input.productId, {variantId: input.variantId, color: input.color, size: input.size}, input.qty);
    return c.json(await answerCart(c, db, cart.id));
  })

  .patch('/items/:lineId', params(lineParam), json(qtyBody), withViewer, withDb, withLocale, async c => {
    const {qty} = c.req.valid('json');
    const db = dbOf(c);
    const cart = await writableCart(c, db);
    const line = await findLine(db, cart.id, c.req.valid('param').lineId);
    if (qty === 0) {
      await db.cartLine.delete({where: {id: line.id}});
    } else {
      assertStock(line.product.name, line.variant, qty, line.product.allowBackorder);
      await db.cartLine.update({where: {id: line.id}, data: {qty}});
    }
    return c.json(await answerCart(c, db, cart.id));
  })

  .delete('/items/:lineId', params(lineParam), withViewer, withDb, withLocale, async c => {
    const db = dbOf(c);
    const cart = await writableCart(c, db);
    const line = await findLine(db, cart.id, c.req.valid('param').lineId);
    await db.cartLine.delete({where: {id: line.id}});
    return c.json(await answerCart(c, db, cart.id));
  })

  .post('/discount', json(discountBody), withViewer, withDb, withLocale, async c => {
    const {code, country, method, email} = c.req.valid('json');
    const db = dbOf(c);
    const cart = await writableCart(c, db);
    // Price the bag with the new code. Below a minimum (spend or quantity) the code is kept on the bag and
    // Cart.discountError says what's missing; every other reason is a 422 and the bag is left unchanged.
    // On the checkout page the selected country and method come along, so free shipping is valued at that rate.
    const shippingRate = country || method ? await selectedRate(db, country, method) : 0;
    const priced = await priceBag(db, cart, {
      code,
      shippingRate,
      country: country || null,
      email: email || null,
      loc: await locOf(c),
    });
    const err = priced.result.rejected;
    // Free shipping is worth nothing until a method is chosen: keep the code, so it can win at checkout.
    const shippingLater =
      err?.code === 'DISCOUNT_NOT_COMBINABLE' && priced.code?.discount.kind === 'shipping' && !country && !method;
    if (err && !KEEPS_CODE.includes(err.code) && !shippingLater) throw new HttpError(422, err.code, err.message);
    const updated = await db.cart.update({where: {id: cart.id}, data: {discountCode: code}, include: cartInclude});
    return c.json(cartOf(updated, priced));
  })

  .delete('/discount', withViewer, withDb, withLocale, async c => {
    const db = dbOf(c);
    const cart = await writableCart(c, db);
    if (cart.discountCode != null) await db.cart.update({where: {id: cart.id}, data: {discountCode: null}});
    return c.json(await answerCart(c, db, cart.id));
  })

  .post('/email', json(emailBody), withViewer, withDb, withLocale, async c => {
    const {email} = c.req.valid('json');
    const db = dbOf(c);
    await rateLimit(c, db, 'cartEmail');
    const cart = await writableCart(c, db);
    const {locale} = await locOf(c);
    // Only a real change touches the row: `updatedAt` stays the bag's last activity (abandoned-bag idle check).
    if (cart.email !== email || cart.locale !== locale) {
      await db.cart.update({where: {id: cart.id}, data: {email, locale}});
    }
    return c.json({email});
  })

  .get('/recover/:token', params(tokenParam), withViewer, withDb, async c => {
    const db = dbOf(c);
    const token = c.req.valid('param').token;
    const secret = config.jwtSecret;
    const cartId = secret && token.length <= TOKEN_MAX ? await verifyRecoveryToken(secret, token) : null;
    const source = cartId ? await db.cart.findUnique({where: {id: cartId}, select: sourceSelect}) : null;
    if (!source) return toCartPage(c);

    try {
      await mergeGuestBag(c, db);
      const owner = await ownerOf(c);
      if (owner.visitorId && !source.userId) {
        // A guest bag opened by a guest: attach the bag itself to this visitor, folding in anything already in
        // this browser's bag.
        if (source.visitorId !== owner.visitorId) {
          await db.$transaction(async tx => {
            const mine = await tx.cart.findUnique({where: {visitorId: owner.visitorId}, select: sourceSelect});
            if (mine && mine.id !== source.id) {
              for (const l of mine.lines) await mergeLine(tx, source.id, l);
              if (!source.discountCode && mine.discountCode) {
                await tx.cart.update({where: {id: source.id}, data: {discountCode: mine.discountCode}});
              }
              // Frees the unique visitor id for the recovered bag.
              await tx.cart.delete({where: {id: mine.id}});
            }
            await tx.cart.update({where: {id: source.id}, data: {visitorId: owner.visitorId}});
          });
        }
      } else {
        // Signed in, or an account's bag opened elsewhere: copy the pieces into this visitor's bag.
        const target = await getOrCreateCart(db, owner);
        if (target.id !== source.id) {
          await db.$transaction(async tx => {
            for (const l of source.lines) await mergeLine(tx, target.id, l);
            if (!target.discountCode && source.discountCode) {
              await tx.cart.update({where: {id: target.id}, data: {discountCode: source.discountCode}});
            }
            if (!target.email && source.email) await tx.cart.update({where: {id: target.id}, data: {email: source.email}});
          });
        }
      }
    } catch (err) {
      // The shopper always lands on the bag; a failed restore leaves both bags as they were.
      console.error(`cart recover: ${(err as Error).message}`);
    }
    return toCartPage(c);
  });
