import type {MiddlewareHandler} from 'hono';

import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import type {EventType} from '../../lib/types/events';

/**
 * Cross-package contracts (PLAN.md §4–5): functions one Wave 1 package calls and ANOTHER package
 * implements. Wave 0 writes each signature with a WORKING stub (safe no-op or pass-through) so every
 * caller compiles and runs from day one; the owning package replaces the BODY, never the signature
 * (or re-exports its implementation from here with the same signature). Callers always import from
 * this file, never from the owner's module, so merge order never matters.
 *
 *   sendTemplate      WP-22 (emails)          records a templated email in the outbox, sends via job
 *   refundOrder       WP-11 (payments)        gives money back through the order's provider
 *   restockOrder      WP-11 (payments)        puts an order's reserved stock back
 *   recordActivity    WP-26 (staff/activity)  one row in the staff activity log
 *   activityLog       WP-26                   middleware on /site-api/manage: logs each successful write
 *   localize          F4 base, WP-25 extends  content translations for storefront rows
 *   localizeMessage   F4 (i18n/messages.ts)   error messages in the request language
 *   queueEntityTranslation WP-25             after an admin save: queue the record's machine translations
 *   trackEvent        WP-16 (analytics)       one storefront analytics event from server code
 *
 * Every function here NEVER throws for its side effect (an email, a log line, an event must not
 * break the request), except `refundOrder`, whose failure the admin must see.
 */

/** A client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

// ─── Email (WP-22) ────────────────────────────────────────────────────────────

export type EmailVarValue = string | number | boolean | null | Record<string, string | number | null>[];
export type EmailVars = Record<string, EmailVarValue>;

export interface SendTemplateOptions {
  /** The current request's URL: `sendJob` needs it to queue the `send-email` job. */
  requestUrl?: string;
  /** What the email is about, for the message log (`{type: 'order', id: 'VRL-24914'}`). */
  related?: {type: string; id: string};
  replyTo?: string;
  /** The recipient's language (defaults to the store's default locale). */
  locale?: string;
}

/**
 * Send a templated email (VAREL `lib/email/send.ts` `sendTemplate`): renders the template `key`
 * (`order_confirmation`, `abandoned_cart`, `account_deleted`, …) with `vars`, records it in the
 * outbox (`EmailMessage`) and queues the provider send as a background job. Never throws.
 *
 * WP-22 implements. Stub: logs and does nothing.
 */
export async function sendTemplate(
  _db: Db,
  key: string,
  to: string,
  _vars: EmailVars,
  _opts: SendTemplateOptions = {}
): Promise<void> {
  console.info(`[email] ${key} → ${to.replace(/^(.).*(@.*)$/, '$1***$2')} (not sent: email is not built yet)`);
}

// ─── Payments (WP-11) ─────────────────────────────────────────────────────────

export interface RefundableOrder {
  id: number | string;
  number: string;
  /** `simulated` | `stripe` */
  paymentProvider: string;
  currency: string;
}

/**
 * Give `amountCents` back through the provider the order was paid with and record it on the
 * payment row (VAREL `refundOrderPayment`). Capped at what is left on the payment; idempotent per
 * order and `reason` (a retried admin action never refunds twice). Returns the cents given back.
 * Throws an `HttpError` (502 `payment_provider_error`) when the provider refuses.
 *
 * WP-11 implements. Stub: the simulated provider always succeeds, nothing is recorded.
 */
export async function refundOrder(_db: Db, _order: RefundableOrder, amountCents: number, _reason: string): Promise<number> {
  return Number.isSafeInteger(amountCents) && amountCents > 0 ? amountCents : 0;
}

/**
 * Put an order's reserved stock back (physical lines with tracked inventory). Safe to call inside
 * a transaction. Returns the units restocked (VAREL `restockOrder`).
 *
 * WP-11 implements. Stub: restocks nothing.
 */
export async function restockOrder(_db: Db, _orderId: number | string): Promise<number> {
  return 0;
}

// ─── Activity log (WP-26) ─────────────────────────────────────────────────────

export interface ActivityActor {
  /** Template user id; null for the system (jobs, webhooks) */
  id: number | null;
  name: string;
}

export interface ActivityTarget {
  /** `product`, `order`, `discount`, … */
  entity: string;
  id?: string | number | null;
}

/**
 * Write one staff activity row (VAREL `logActivity`): `action` like `product.update`, a readable
 * `summary` in `meta.summary` ("Updated product Atelier Wool Coat · price, stock"). Never throws.
 *
 * WP-26 implements. Stub: does nothing.
 */
export async function recordActivity(
  _db: Db,
  _actor: ActivityActor | null,
  _action: string,
  _target: ActivityTarget,
  _meta: {summary?: string} & Record<string, unknown> = {}
): Promise<void> {}

/**
 * Middleware on every `/site-api/manage/*` request (VAREL `activityLog()`): after a successful
 * write (POST/PATCH/PUT/DELETE, 2xx) it records one activity row built from the route, the body
 * and the response. Never fails the request.
 *
 * WP-26 implements. Stub: passes through.
 */
export const activityLog: MiddlewareHandler = async (_c, next) => {
  await next();
};

// ─── i18n (F4 base, WP-25) ────────────────────────────────────────────────────

/**
 * Storefront rows with their translatable fields in `locale` (VAREL `lib/i18n/localize.ts`):
 * each row's `fields` (all translatable fields of `entity` when omitted) are replaced by the
 * `Translation` rows for (entity, row.id, locale), falling back to the source text. The default
 * locale returns the rows unchanged. One bounded query for all rows. Never throws.
 *
 * F4 provides the working base; WP-25 extends. Stub: returns the rows unchanged.
 */
export async function localize<T extends {id: string | number}>(
  rows: T[],
  _entity: string,
  _locale: string,
  _fields?: readonly string[]
): Promise<T[]> {
  return rows;
}

/** An English error message in `locale` (VAREL `localizeMessage`). F4 implements. Stub: unchanged. */
export function localizeMessage(_locale: string, message: string): string {
  return message;
}

/** Field error messages in `locale` (VAREL `localizeFields`). F4 implements. Stub: unchanged. */
export function localizeFields(
  _locale: string,
  fields: Record<string, string> | undefined
): Record<string, string> | undefined {
  return fields;
}

/**
 * After an admin save (VAREL `lib/i18n/hooks.ts`): read the record's source fields back and queue
 * their machine translations for every enabled locale (products also queue their colour names as
 * `option`, posts their category as `post_category`). The work runs as a background job, so the
 * write never waits on a provider; the hourly `translations-backfill` job catches anything missed.
 * Never throws. Entities: product, department, category, collection, post, page, menu, discount, setting.
 *
 * WP-25 implements. Stub: does nothing (the backfill job covers it once WP-25 lands).
 */
export async function queueEntityTranslation(
  _db: Db,
  _entity: string,
  _id: string | number | null | undefined,
  _opts: {requestUrl?: string} = {}
): Promise<void> {}

// ─── Analytics (WP-16) ────────────────────────────────────────────────────────

export interface ServerEvent {
  type: EventType | 'purchase';
  path?: string;
  productId?: string;
  query?: string;
  results?: number;
  /** Guest visitor id (src/server/lib/visitor.ts) */
  visitorId?: string | null;
  userId?: number | null;
}

/**
 * Record one analytics event from server code (search results, checkout start), only when the
 * store has analytics on. Never throws.
 *
 * WP-16: same normalisation as `POST /site-api/events` (src/server/routes/events.ts). `purchase` is a
 * documented no-op (purchases are read from paid orders); product ids are not verified (callers pass real ids).
 */
export async function trackEvent(db: Db, event: ServerEvent): Promise<void> {
  if (event.type === 'purchase') return;
  try {
    const settings = await db.setting.findUnique({where: {id: 1}, select: {analyticsEnabled: true}});
    if (settings && !settings.analyticsEnabled) return;
    const search = event.type === 'search';
    const query = search && event.query ? event.query.trim().slice(0, 120).toLowerCase() : '';
    const results = search && Number.isInteger(event.results) && (event.results ?? -1) >= 0 ? (event.results ?? null) : null;
    await db.analyticsEvent.create({
      data: {
        type: event.type,
        sessionId: event.visitorId ? event.visitorId.slice(0, 64) : null,
        userId: event.userId ?? null,
        productId: event.productId ? event.productId.slice(0, 120) : null,
        query: query || null,
        results,
        path: event.path ? event.path.slice(0, 300) : null,
      },
    });
  } catch {
    console.error('[analytics] trackEvent failed');
  }
}
