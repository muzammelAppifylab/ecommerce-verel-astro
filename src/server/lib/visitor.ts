/* Guest identity for bags and wishlists (PLAN.md D5; replaces VAREL's `varel_sid` Session).
   Every storefront visitor gets a random id in the `visitor_id` cookie: HttpOnly, SameSite=Lax, a year, Secure
   on https. It is NOT an auth cookie: it only names a guest bag / wishlist (Visitor row, created lazily by
   `ensureVisitor`). Signed-in visitors own their bag by user id; `mergeGuestIntoUser` (./cart.ts) moves the
   guest's pieces over after sign-in.
   Use `withVisitor` on the storefront routes that read or write a guest bag/wishlist (cart, wishlist,
   checkout); routes then call `ownerOf(c)` (./cart.ts) or `visitorIdOf(c)`. */
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Db } from './db'

export const VISITOR_COOKIE = 'visitor_id'
const ONE_YEAR_S = 365 * 24 * 60 * 60
/** Longest visitor id the database takes (visitors.id VarChar(64)). */
export const VISITOR_ID_MAX = 64
/** Ids we accept from the cookie: 32–64 lower-case hex characters. New ids are 48 (24 random bytes). */
export const VISITOR_RE = /^[a-f0-9]{32,64}$/

export function newVisitorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The visitor id in the request's cookie, or null when absent or malformed. */
export function readVisitorId(c: Pick<Context, 'req'>): string | null {
  const v = getCookie(c as Context, VISITOR_COOKIE)?.trim().toLowerCase()
  return v && VISITOR_RE.test(v) ? v : null
}

/** Cookie attributes: Secure on https (and never on plain http, so local dev keeps it). */
export function visitorCookieOptions(url: string) {
  const secure = new URL(url).protocol === 'https:'
  return { path: '/', httpOnly: true, sameSite: 'Lax' as const, secure, maxAge: ONE_YEAR_S }
}

type VisitorVars = { Variables: { visitorId: string } }

/** Hono middleware: `c.var.visitorId` from the cookie, or a new id set as the cookie on the response. */
export const withVisitor: MiddlewareHandler<VisitorVars> = async (c, next) => {
  let id = readVisitorId(c)
  if (!id) {
    id = newVisitorId()
    setCookie(c, VISITOR_COOKIE, id, visitorCookieOptions(c.req.url))
  }
  c.set('visitorId', id)
  await next()
}

/** The request's visitor id: `c.var.visitorId` when `withVisitor` ran, else the cookie (or a new id, set now). */
export function visitorIdOf(c: Context): string {
  const known = (c.get as (name: string) => unknown)('visitorId')
  if (typeof known === 'string' && known) return known
  let id = readVisitorId(c)
  if (!id) {
    id = newVisitorId()
    setCookie(c, VISITOR_COOKIE, id, visitorCookieOptions(c.req.url))
  }
  ;(c.set as (name: string, value: unknown) => void)('visitorId', id)
  return id
}

/** Make sure the Visitor row exists before attaching a guest bag or wishlist to it (and note it was seen). */
export async function ensureVisitor(db: Db, id: string): Promise<void> {
  await db.visitor.upsert({
    where: { id },
    create: { id },
    update: { lastSeenAt: new Date() },
  })
}
