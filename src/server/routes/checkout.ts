import {Hono} from 'hono';
import {createMiddleware} from 'hono/factory';
import {z} from 'zod';

import {Prisma, type PrismaClient} from '../../generated/prisma/client';
import {problem, withDb, withViewer} from '../../platform/guards';
import type {Viewer} from '../../platform/types';
import type {CheckoutConfig, CheckoutPayment, CheckoutResponse} from '../../lib/types/orders';
import {addressFormat, checkStreet, checkZip, cityWithRegion, findRegion, hasLetter, normalizeZip} from '../lib/address-formats';
import {cartInclude, getOrCreateCart, orderSnapshot, ownerOf, priceBag, reserveStock, type CartRow, type PricedBag} from '../lib/cart';
import {applyCheckoutRules, checkoutRuleFields} from '../lib/checkout-rules';
import {canonicalCountry, isKnownCountry} from '../lib/countries';
import type {Db} from '../lib/db';
import {KEEPS_CODE} from '../lib/discounts';
import {HttpError, invalid, notFound} from '../lib/errors';
import {normEmail, plural} from '../lib/format';
import {locOf, type Loc} from '../lib/i18n/localize';
import {fromCents, toCents} from '../lib/money';
import {DELIVERED_EVENT, isOwner, nextOrderNumber, normalizeOrderNumber} from '../lib/orders';
import {getProvider, paymentConfig} from '../lib/payments/index';
import {
  emailCtxOf,
  failOrder,
  formatMoney,
  markOrderPaid,
  notifyLowStock,
  restoreBag,
  sendOrderConfirmation,
} from '../lib/payments/lifecycle';
import {simulateCharge} from '../lib/payments/simulated';
import type {EngineDiscount} from '../lib/promotions-types';
import {orderInclude, photoOf, serializeOrder} from '../lib/serializers';
import {getSettings} from '../lib/settings';
import {zoneForCountry} from '../lib/shipping';
import {summaryLabel} from '../lib/totals';
import {emailField, json, optionalText, params, requiredText} from '../lib/validate';
import {withVisitor} from '../lib/visitor';

/**
 * Checkout (VAREL own payments, D3). Port of VAREL worker/routes/checkout.ts (WP-11): VAREL
 * `/api/<path>` is `/site-api/<path>` here, same shapes (src/lib/types/orders.ts), errors as
 * `{error, message, fields?}` (codes lower-cased on the wire: `total_changed`, `payment_declined`…).
 *
 *   GET    /site-api/checkout/config                   CheckoutConfig
 *   POST   /site-api/checkout                          CheckoutRequest → 201 CheckoutResponse (402 declined, 409 total_changed, 422 discount_*)
 *   POST   /site-api/checkout/:number/sync             settle a Stripe order against Stripe → {order}
 *   POST   /site-api/checkout/:number/cancel           abandon an unpaid Stripe order, restore the bag → {order, restored}
 *
 * POST /checkout validates, prices the bag (lib/cart priceBag), reserves stock and writes the order and its discount
 * usage in one transaction, then takes payment through the active provider:
 * - simulated: the card is checked and the order is Paid right away (order_confirmation is sent);
 * - stripe: the order stays Pending and a PaymentIntent is created; the client confirms it with the Payment Element.
 *   The webhook (routes/payments-webhooks.ts), the confirmation poll (`/:number/sync`) and the expiry job settle it.
 * Mounted after `sameOrigin` + `csrf` (JSON from `siteFetch`, which sends the token).
 */

/** A signed-in shopper whose access token expired is asked to refresh (siteFetch retries), never placed as a guest. */
const returningIs401 = createMiddleware<{Variables: {viewer: Viewer}}>(async (c, next) => {
  if (c.var.viewer.state === 'returning') return c.json(problem('token_expired', 'Your session needs refreshing.'), 401);
  await next();
});

type Shopper = {id: number; email: string};
const userOf = (viewer: Viewer | undefined): Shopper | null =>
  viewer?.state === 'user' && viewer.id != null ? {id: viewer.id, email: viewer.email ?? ''} : null;

/** Discounts whose use is counted against earlier orders (locked in the order transaction). */
const isLimited = (d: EngineDiscount) => d.usageLimit != null || d.perCustomerLimit != null || d.eligibility === 'first_order';

const sameMoney = (a: number, b: number) => toCents(a) === toCents(b);

const totalChanged = (total: number, currency: string) =>
  new HttpError(409, 'TOTAL_CHANGED', `Your total is now ${formatMoney(total, currency)}. Check your order summary and place the order again`);

const cartEmpty = () => new HttpError(422, 'CART_EMPTY', 'Your bag is empty. Add a piece before checking out');

const ZIP_NAME = {zip: 'ZIP code', postal: 'postal code', postcode: 'postcode', eircode: 'Eircode'} as const;
const REGION_NAME = {state: 'state', province: 'province', county: 'county', stateTerritory: 'state or territory', prefecture: 'prefecture'} as const;
const STREET_MESSAGE = {
  required: 'Enter the street address',
  letters: 'Enter the street name as well as the number',
  number: 'Add the house or building number',
} as const;

// The address as the country writes it (lib/address-formats.ts, shared with the storefront form): postcode pattern,
// state / province where one is part of the address (written after the city), a street line that looks like one.
const addressSchema = z
  .object({
    name: requiredText('the full name', 120),
    line1: requiredText('the street address', 200),
    line2: optionalText(200),
    city: requiredText('the city', 120),
    region: optionalText(80),
    zip: z
      .string()
      .trim()
      .max(20, 'Keep the postcode under 20 characters')
      .nullish()
      .transform(v => v ?? ''),
    country: requiredText('the country', 80).refine(isKnownCountry, 'Choose a country we ship to').transform(canonicalCountry),
  })
  .superRefine((a, ctx) => {
    const f = addressFormat(a.country);
    const issue = (path: string, message: string) => ctx.addIssue({code: 'custom', path: [path], message});
    if (!hasLetter(a.name)) issue('name', 'Enter the full name');
    const street = checkStreet(a.country, a.line1);
    if (street) issue('line1', STREET_MESSAGE[street]);
    if (!hasLetter(a.city)) issue('city', 'Enter the city');
    const zip = checkZip(a.country, a.zip);
    if (zip === 'required') issue('zip', `Enter the ${ZIP_NAME[f.zip.label]}`);
    else if (zip === 'format') issue('zip', `Check the ${ZIP_NAME[f.zip.label]}, for example ${f.zip.example}`);
    if (f.region && !findRegion(a.country, a.region ?? '')) issue('region', `Choose a ${REGION_NAME[f.region.label]}`);
  })
  .transform(({region, ...a}) => ({
    ...a,
    zip: normalizeZip(a.country, a.zip),
    city: cityWithRegion(a.country, a.city, region ?? ''),
  }));

const cardSchema = z.object(
  {
    name: z.string({error: 'Enter the name on the card'}).max(120),
    number: z.string({error: 'Enter your card number'}).max(40),
    expiry: z.string({error: 'Enter the expiry date'}).max(10),
    cvc: z.string({error: 'Enter the security code'}).max(6),
  },
  {error: 'Enter your card details'}
);

const checkoutBody = z.object({
  email: emailField,
  phone: optionalText(40),
  newsletter: z.boolean().optional().default(false),
  shippingAddress: addressSchema.nullable().optional().default(null),
  shippingMethodId: z.string().trim().max(80).nullable().optional().default(null),
  billingSameAsShipping: z.boolean().optional().default(true),
  billingAddress: addressSchema.nullable().optional(),
  /** Card details for the simulated provider. Stripe collects them in the Payment Element instead. */
  payment: cardSchema.nullable().optional(),
  saveAddress: z.boolean().optional().default(false),
  /** The total the customer saw; a different server total returns 409 TOTAL_CHANGED before any payment */
  expectedTotal: z.number().finite().nonnegative().optional(),
  ...checkoutRuleFields, // customerNote, acceptTerms (settings core)
});

type CheckoutInput = z.output<typeof checkoutBody>;
type ShippingAddress = NonNullable<CheckoutInput['shippingAddress']>;

const numberParam = z.object({number: z.string().trim().min(1, 'Enter the order number').max(40, 'Check the order number')});
const ownerBody = z.object({email: z.string().trim().max(254).optional()});

/** A Prisma error from two checkouts racing (order number, deadlock between discount row locks): retry alone. */
function isRace(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    const cause = (err as {cause?: {code?: unknown}} | null)?.cause;
    return cause?.code === '40P01';
  }
  if (err.code === 'P2002' || err.code === 'P2034') return true;
  const causeCode = (err as {cause?: {code?: unknown}}).cause?.code;
  return err.code === 'P2010' && (/40P01|deadlock/i.test(err.message) || causeCode === '40P01');
}

const addressJson = (a: ShippingAddress | null | undefined) =>
  a ? {name: a.name, line1: a.line1, line2: a.line2 ?? null, city: a.city, zip: a.zip, country: a.country} : Prisma.JsonNull;

/** The order transaction: re-price under row locks, write the order, its redemptions and unique code, empty the bag. */
async function writeOrder(
  db: PrismaClient,
  args: {
    cartId: number;
    input: CheckoutInput;
    user: Shopper | null;
    loc: Loc;
    priceWith: (tx: Db, bag: CartRow) => Promise<PricedBag>;
    previewTotal: number;
    provider: 'stripe' | 'simulated';
    charge: boolean;
    card: {brand: string; last4: string} | null;
    method: {name: string; detail: string; rate: number} | null;
    shippingAddress: ShippingAddress | null;
    billingAddress: ShippingAddress | null;
    customerNote: string | null;
  }
) {
  const {cartId, input, user, provider, card, method} = args;
  const pending = provider === 'stripe';
  return db.$transaction(
    async tx => {
      const fresh = await tx.cart.findUniqueOrThrow({where: {id: cartId}, include: cartInclude});
      if (!fresh.lines.length) throw cartEmpty();

      // Re-validate stock and decrement atomically (backorder products may go below zero). For Stripe this is the
      // reservation: a failed or expired payment puts it back.
      await reserveStock(tx, fresh.lines);
      // Digital download keys are snapshotted on the order lines (the bag select leaves them out).
      const digitalIds = [...new Set(fresh.lines.filter(l => l.product.type === 'digital').map(l => l.product.id))];
      const downloads = new Map(
        digitalIds.length
          ? (await tx.product.findMany({where: {id: {in: digitalIds}}, select: {id: true, download: true}})).map(p => [p.id, p.download] as const)
          : []
      );

      // Usage limits, per-customer limits and first-order checks are counted, then written below. Lock the discounts
      // that have them (row lock until commit) and count again, so two checkouts can't both take the last use.
      const locked = new Set<string>();
      let priced = await args.priceWith(tx, fresh);
      for (;;) {
        const ids = priced.discounts.filter(d => isLimited(d) && !locked.has(d.id)).map(d => d.id);
        if (!ids.length) break;
        const all = [...locked, ...ids].map(Number).sort((a, b) => a - b);
        await tx.$queryRaw`SELECT "id" FROM "discounts" WHERE "id" IN (${Prisma.join(all)}) ORDER BY "id" FOR UPDATE`;
        for (const id of ids) locked.add(id);
        priced = await args.priceWith(tx, fresh);
      }
      const {totals, result} = priced;
      // The customer agreed to the previewed total (and the payment provider was chosen from it).
      if (!sameMoney(totals.total, args.previewTotal)) throw totalChanged(totals.total, priced.settings.currency);
      const codeApplied = result.applied.find(a => a.method === 'code') ?? null;
      // Only discounts that saved something use up a limit or a unique code (e.g. free shipping on a bag that
      // ships free anyway is not a use).
      const saving = result.applied.filter(a => a.amount > 0 || (a.freeShipping && priced.shippingSaved > 0));
      // Digital-only orders are delivered once paid (Stripe orders wait for the payment).
      const delivered = !totals.physical && !pending;
      const number = await nextOrderNumber(tx, priced.settings.orderPrefix);
      const snapshot = orderSnapshot(priced); // currency, pricesIncludeTax, taxRate
      const units = fresh.lines.reduce((n, l) => n + l.qty, 0);
      const now = Date.now();

      const order = await tx.shopOrder.create({
        data: {
          number,
          userId: user?.id ?? null,
          email: input.email,
          phone: input.phone,
          payment: pending ? 'Pending' : 'Paid',
          paymentProvider: provider,
          fulfillment: delivered ? 'Delivered' : 'Unfulfilled',
          stage: delivered ? 4 : 1,
          method: (method ? `${method.name} · ${method.detail}` : 'Digital delivery').slice(0, 200),
          address: addressJson(args.shippingAddress),
          billingSameAsShipping: input.billingSameAsShipping,
          billingAddress: addressJson(args.billingAddress),
          cardBrand: card?.brand ?? null,
          cardLast4: card?.last4 ?? null,
          subtotalCents: toCents(totals.subtotal),
          discountCode: codeApplied?.code ?? null,
          discountId: codeApplied ? Number(codeApplied.discountId) : null,
          discountCents: toCents(totals.discount),
          shippingCents: toCents(totals.shipping),
          taxCents: toCents(totals.tax),
          totalCents: toCents(totals.total),
          currency: snapshot.currency,
          pricesIncludeTax: snapshot.pricesIncludeTax,
          taxRate: snapshot.taxRate,
          customerNote: args.customerNote,
          locale: args.loc.locale,
          items: {
            create: fresh.lines.map((l, i) => ({
              productId: l.product.id,
              name: l.product.name,
              category: l.product.category.name,
              sku: l.variant.id,
              color: l.variant.color,
              size: l.variant.size,
              options: (l.variant.options ?? {}) as Prisma.InputJsonValue,
              qty: l.qty,
              priceCents: l.variant.priceCents,
              discountCents: toCents(result.lineDiscounts[String(l.id)] ?? 0),
              digital: l.product.type === 'digital',
              image: {...photoOf(l.product.images[0])},
              download: downloads.get(l.product.id) ?? null,
              position: i,
            })),
          },
          events: {
            create: [
              {
                kind: 'placed',
                at: new Date(now), // one clock for both events, so "delivered" always sorts after "placed"
                message: `Order placed${user ? '' : ' as a guest'} · ${plural(units, 'item')}${pending ? ' · awaiting payment' : ''}`,
              },
              ...(delivered ? [{kind: 'status', message: `${DELIVERED_EVENT} · digital delivery`, at: new Date(now + 1)}] : []),
            ],
          },
          ...(args.charge
            ? {
                payments: {
                  create: {
                    provider,
                    status: pending ? 'requires_payment' : 'succeeded',
                    amountCents: toCents(totals.total),
                    currency: snapshot.currency,
                    cardBrand: card?.brand ?? null,
                    cardLast4: card?.last4 ?? null,
                  },
                },
              }
            : {}),
        },
        select: {id: true},
      });

      // One redemption per applied discount (automatic ones too). Free shipping records the shipping it saved.
      // The label is snapshotted in the source text (like the order), so later edits don't rewrite this order.
      if (saving.length) {
        const rows = await tx.discount.findMany({
          where: {id: {in: saving.map(a => Number(a.discountId))}},
          select: {id: true, method: true, name: true, code: true, label: true},
        });
        await tx.discountRedemption.createMany({
          data: saving.map(a => {
            const d = rows.find(r => String(r.id) === a.discountId);
            return {
              discountId: Number(a.discountId),
              orderId: order.id,
              userId: user?.id ?? null,
              email: input.email,
              code: a.code,
              amountCents: toCents(a.freeShipping ? priced.shippingSaved : a.amount),
              label: d ? summaryLabel({method: d.method, name: d.name || d.code || d.label, label: d.label}, a.code).slice(0, 200) : null,
              freeShipping: a.freeShipping,
            };
          }),
        });
      }
      // A unique code can be redeemed once: mark it used only if nobody else just did (else roll back).
      if (codeApplied && saving.includes(codeApplied) && priced.code?.uniqueCode) {
        const used = await tx.discountCode.updateMany({
          where: {id: priced.code.uniqueCode.id, usedAt: null},
          data: {usedAt: new Date(), orderId: order.id},
        });
        if (used.count === 0) throw new HttpError(409, 'DISCOUNT_USED_UP', `${priced.code.uniqueCode.code} has already been used`);
      }

      await tx.cartLine.deleteMany({where: {cartId}});
      await tx.cart.update({where: {id: cartId}, data: {discountCode: null}});
      // Re-read so the response carries the redemptions written above (Order.discounts).
      return tx.shopOrder.findUniqueOrThrow({where: {id: order.id}, include: orderInclude});
    },
    {timeout: 15_000, maxWait: 5_000}
  );
}

/** After the order: save the address, subscribe to the newsletter. Never fails the order. */
async function afterOrder(db: Db, user: Shopper | null, input: CheckoutInput, shippingAddress: ShippingAddress | null) {
  try {
    // addresses.city is VarChar(100) while checkout allows 120: never truncate, skip saving instead.
    if (user && input.saveAddress && shippingAddress && shippingAddress.city.length <= 100) {
      const a = shippingAddress;
      const existing = await db.address.findFirst({
        where: {userId: user.id, line1: a.line1, zip: a.zip, city: a.city, country: a.country, name: a.name},
        select: {id: true},
      });
      if (!existing) {
        const any = await db.address.findFirst({where: {userId: user.id}, select: {id: true}});
        await db.address.create({
          data: {
            userId: user.id,
            name: a.name,
            line1: a.line1,
            line2: a.line2 ?? null,
            city: a.city,
            zip: a.zip,
            country: a.country,
            phone: input.phone,
            primary: !any,
          },
        });
      }
    }
    if (input.newsletter) {
      await db.newsletterSubscriber.upsert({
        where: {email: input.email},
        create: {email: input.email, source: 'checkout'},
        update: {},
      });
      // VAREL set users.newsletter for that email; here the opt-in lives on the shopper's own profile, and only
      // for the signed-in account's own address (a guest typing an account's email doesn't flip it).
      if (user && normEmail(user.email) === normEmail(input.email)) {
        await db.customerProfile.upsert({
          where: {userId: user.id},
          create: {userId: user.id, marketingOptIn: true},
          update: {marketingOptIn: true},
        });
      }
    }
  } catch (err) {
    console.error('[checkout] post-checkout step failed', err instanceof Error ? err.message : err);
  }
}

type OrderCtx = {var: {viewer: Viewer; db: PrismaClient}};

/** The order, when the visitor may see it (account owner or matching email), else 404. */
async function ownOrder(c: OrderCtx, rawNumber: string, email: string | undefined) {
  const db = c.var.db;
  const settings = await getSettings(db); // the store's order prefix, even on a fresh isolate
  const order = await db.shopOrder.findUnique({
    where: {number: normalizeOrderNumber(rawNumber, settings.orderPrefix)},
    select: {
      id: true,
      number: true,
      userId: true,
      email: true,
      payment: true,
      paymentProvider: true,
      payments: {select: {provider: true, providerRef: true}, orderBy: {createdAt: 'desc'}, take: 20},
    },
  });
  const allowed = order && (isOwner(userOf(c.var.viewer), order) || (!!email && normEmail(email) === normEmail(order.email)));
  if (!order || !allowed) throw notFound('We cannot find that order');
  return order;
}

const reload = (db: Db, id: number) => db.shopOrder.findUniqueOrThrow({where: {id}, include: orderInclude});

/** Mounted at `/site-api/checkout` (src/server/app.ts). */
export const checkoutRoutes = new Hono()
  /** Which provider checkout uses right now (simulated whenever Stripe isn't fully configured). Reads no visitor. */
  .get('/config', withDb, async c => {
    const cfg = await paymentConfig(c.var.db);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({provider: cfg.provider, publishableKey: cfg.publishableKey, currency: cfg.currency} satisfies CheckoutConfig);
  })

  // I2: rate limit.
  .post('/', json(checkoutBody), withViewer, returningIs401, withDb, withVisitor, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const loc = await locOf(c); // messages in the request language (order snapshots stay in the source text)
    const user = userOf(c.var.viewer);
    const rules = await applyCheckoutRules(db, user, input); // guest checkout, phone, terms, order notes
    const cart = await getOrCreateCart(db, await ownerOf(c));
    if (!cart.lines.length) throw cartEmpty();

    const physical = cart.lines.some(l => l.product.type !== 'digital');

    // Shipping
    let method: {name: string; detail: string; rate: number} | null = null;
    if (physical) {
      if (!input.shippingAddress) throw invalid({shippingAddress: 'Enter a shipping address'});
      const zone = await zoneForCountry(db, input.shippingAddress.country);
      const m = zone.methods.find(x => x.id === input.shippingMethodId);
      if (!m) throw invalid({shippingMethodId: `Choose a shipping method for ${zone.name}`});
      method = {name: m.name, detail: m.detail, rate: fromCents(m.rateCents)};
    }

    const billingAddress = input.billingSameAsShipping ? null : (input.billingAddress ?? null);
    if (!input.billingSameAsShipping && !billingAddress) throw invalid({billingAddress: 'Enter a billing address'});

    // Price check before taking payment — recomputed again inside the transaction, where usage is re-counted.
    // The engine runs at the final 'checkout' stage with the account and checkout email.
    const priceWith = async (tx: Db, bag: CartRow) => {
      const priced = await priceBag(tx, bag, {
        stage: 'checkout',
        shippingRate: method?.rate ?? 0,
        email: input.email,
        country: input.shippingAddress?.country,
        loc,
      });
      const err = priced.result.rejected;
      // A code that can't be used by this customer (first order only, already used…) or became unusable since it
      // was applied (expired, used up…) fails the checkout instead of silently changing the price; the code stays
      // on the bag so the customer can remove it. Below a minimum, or beaten by a better offer, it simply
      // doesn't apply, as in the bag.
      if (err && !KEEPS_CODE.includes(err.code) && err.code !== 'DISCOUNT_NOT_COMBINABLE' && err.code !== 'DISCOUNT_NOT_APPLICABLE') {
        throw new HttpError(422, err.code, err.message);
      }
      return priced;
    };
    const previewed = await priceWith(db, cart);
    const preview = previewed.totals;
    // The page showed a different total (e.g. an offer this email can't use): stop before any payment.
    if (input.expectedTotal != null && !sameMoney(input.expectedTotal, preview.total)) {
      throw totalChanged(preview.total, previewed.settings.currency);
    }

    const cfg = await paymentConfig(db);
    const charge = preview.total > 0;
    const provider = charge ? cfg.provider : 'simulated';
    // Simulated: check the card (and decline the test card) before anything is written.
    let card: {brand: string; last4: string} | null = null;
    if (charge && provider === 'simulated') {
      const r = simulateCharge(input.payment ?? undefined);
      if (!r.ok) throw new HttpError(r.status, r.code, r.message, r.fields);
      card = {brand: r.brand, last4: r.last4};
    }
    const pending = provider === 'stripe';
    const shippingAddress = physical ? (input.shippingAddress ?? null) : null;

    // Retry when two orders race for the same number (or deadlock on discount locks): at most 3 attempts.
    let order: Awaited<ReturnType<typeof writeOrder>> | undefined;
    for (let attempt = 0; !order; attempt++) {
      try {
        order = await writeOrder(db, {
          cartId: cart.id,
          input,
          user,
          loc,
          priceWith,
          previewTotal: preview.total,
          provider,
          charge,
          card,
          method,
          shippingAddress,
          billingAddress,
          customerNote: rules.customerNote,
        });
      } catch (err) {
        if (!isRace(err) || attempt >= 2) throw err;
      }
    }

    const mail = emailCtxOf(c, db);
    // Stock is taken (reserved) when the order is written, for every provider: alert staff on low stock now.
    await notifyLowStock(
      mail,
      order,
      order.items.filter(i => !i.digital).map(i => ({variantId: i.sku, qty: i.qty}))
    );

    // Stripe: create the PaymentIntent for the order. If Stripe fails, give the reservation and the bag back.
    let payment: CheckoutPayment = {provider: 'simulated'};
    if (pending) {
      try {
        const intent = await getProvider('stripe').createIntent({
          amountCents: order.totalCents,
          currency: order.currency,
          orderId: order.id,
          orderNumber: order.number,
          email: order.email,
          storeName: cfg.storeName,
        });
        await db.shopPayment.updateMany({where: {orderId: order.id, provider: 'stripe'}, data: {providerRef: intent.ref}});
        payment = {provider: 'stripe', clientSecret: intent.clientSecret, publishableKey: cfg.publishableKey!};
      } catch (err) {
        console.error('[checkout] PaymentIntent failed', err instanceof Error ? err.message : err);
        await failOrder(db, order.id, {status: 'failed', message: null, reason: 'Payment could not start'}).catch(() => false);
        await restoreBag(db, order.id, cart.id).catch(() => false);
        throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'We could not start the payment. Your bag is as you left it. Try again in a moment');
      }
    }

    await afterOrder(db, user, input, shippingAddress);

    // Paid on the spot (simulated, or nothing to charge): confirm by email now. Stripe orders confirm when paid.
    if (!pending) await sendOrderConfirmation(mail, order.id);

    return c.json({order: serializeOrder(order, loc), payment} satisfies CheckoutResponse, 201);
  })

  // ─── Settling a Stripe order from the browser ──────────────────────────────

  /** Check a Pending Stripe order against Stripe (webhooks may lag): Paid or Failed when it has settled. */
  // I2: rate limit.
  .post('/:number/sync', params(numberParam), json(ownerBody), withViewer, withDb, async c => {
    const {number} = c.req.valid('param');
    const {email} = c.req.valid('json');
    const db = c.var.db;
    const loc = await locOf(c);
    const order = await ownOrder(c, number, email);
    const ref = order.payments.find(p => p.provider === 'stripe' && p.providerRef)?.providerRef;
    if (order.payment === 'Pending' && order.paymentProvider === 'stripe' && ref) {
      const stripe = getProvider('stripe');
      const pi = await stripe.getIntent(ref);
      if (pi.status === 'succeeded') {
        if (await markOrderPaid(db, order.id, pi)) await sendOrderConfirmation(emailCtxOf(c, db), order.id);
      } else if (pi.status === 'canceled') {
        await failOrder(db, order.id, {status: 'canceled', message: pi.failureMessage});
      } else if (pi.status === 'requires_payment_method' && pi.failureMessage) {
        // The last attempt failed (e.g. declined after a bank redirect): release the order like the webhook does.
        await stripe.cancelIntent(ref).catch(() => null);
        await failOrder(db, order.id, {status: 'failed', message: pi.failureMessage});
      }
    }
    return c.json({order: serializeOrder(await reload(db, order.id), loc)});
  })

  /** The customer gave up on this payment (declined card, closed the bank page…): cancel the PaymentIntent, release
      the stock and discount usage, and put the pieces back in the bag so they can try again. Paid orders stay paid. */
  // I2: rate limit.
  .post('/:number/cancel', params(numberParam), json(ownerBody), withViewer, withDb, withVisitor, async c => {
    const {number} = c.req.valid('param');
    const {email} = c.req.valid('json');
    const db = c.var.db;
    const loc = await locOf(c);
    const order = await ownOrder(c, number, email);
    if (order.paymentProvider !== 'stripe' || order.payment === 'Paid' || order.payment === 'Refunded') {
      return c.json({order: serializeOrder(await reload(db, order.id), loc), restored: false});
    }
    const ref = order.payments.find(p => p.provider === 'stripe' && p.providerRef)?.providerRef;
    if (order.payment === 'Pending') {
      const pi = ref ? await getProvider('stripe').cancelIntent(ref) : null;
      if (pi?.status === 'succeeded') {
        // It went through after all.
        if (await markOrderPaid(db, order.id, pi)) await sendOrderConfirmation(emailCtxOf(c, db), order.id);
        return c.json({order: serializeOrder(await reload(db, order.id), loc), restored: false});
      }
      if (pi?.status === 'processing') {
        throw new HttpError(409, 'PAYMENT_PROCESSING', 'Your payment is still being processed. We will email you when it settles');
      }
      await failOrder(db, order.id, {status: 'canceled', message: pi?.failureMessage ?? null, reason: 'Payment cancelled at checkout'});
    }
    const cart = await getOrCreateCart(db, await ownerOf(c));
    const restored = await restoreBag(db, order.id, cart.id);
    return c.json({order: serializeOrder(await reload(db, order.id), loc), restored});
  });
