/* Customer onboarding (WP-15): what VAREL's own `/api/auth/signup` and `/api/auth/login` did besides
   signing in (worker/routes/auth.ts), now that sign-in is the template's (`/site-api/auth/*`, D5):

   - a `CustomerProfile` for every signed-in customer (names, language, marketing opt-in);
   - the sign-up extras the template's `register` cannot carry (first / last name, newsletter);
   - the guest bag and wishlist merged into the account (F4 `mergeGuestIntoUser`);
   - the `welcome` email, once, when the profile is first created for a new account.

   Called by `POST /site-api/account/onboarding` (src/server/routes/i18n.ts) right after a sign-in on the
   `/account/*` pages. WP-13 also calls `ensureCustomerProfile` before reading the profile. */
import type { Prisma } from '../../generated/prisma/client'
import type { Db } from './db'

/** `CustomerProfile` columns every caller needs. */
export const profileSelect = {
  id: true,
  firstName: true,
  lastName: true,
  locale: true,
  marketingOptIn: true,
} satisfies Prisma.CustomerProfileSelect

export type ProfileRow = Prisma.CustomerProfileGetPayload<{ select: typeof profileSelect }>

/** Profile name columns are `VarChar(80)`. */
export const NAME_MAX = 80

const clip = (s: string) => s.trim().slice(0, NAME_MAX)

/** "Mary Ann Smith" → { firstName: 'Mary', lastName: 'Ann Smith' }; empty or null → two empty strings. */
export function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  const [first, ...rest] = parts
  return { firstName: clip(first!), lastName: clip(rest.join(' ')) }
}

export interface ProfileSeed {
  firstName?: string | null
  lastName?: string | null
  locale?: string | null
}

const isUniqueViolation = (e: unknown) => (e as { code?: unknown } | null)?.code === 'P2002'

/**
 * The customer's profile, created when missing. Names come from `seed` when given, else from the account
 * name (`users.name`, split at the first space). An existing profile is returned as it is (names are never
 * overwritten here). Two tabs racing: the loser of the unique `user_id` insert re-reads the winner's row.
 */
export async function ensureCustomerProfile(
  db: Db,
  user: { id: number; name: string | null },
  seed: ProfileSeed = {},
): Promise<{ profile: ProfileRow; created: boolean }> {
  const existing = await db.customerProfile.findUnique({ where: { userId: user.id }, select: profileSelect })
  if (existing) return { profile: existing, created: false }

  const fromName = splitName(user.name)
  const firstName = seed.firstName?.trim() ? clip(seed.firstName) : fromName.firstName
  const lastName = seed.lastName?.trim() ? clip(seed.lastName) : fromName.lastName
  try {
    const profile = await db.customerProfile.create({
      data: { userId: user.id, firstName, lastName, ...(seed.locale ? { locale: seed.locale.slice(0, 10) } : {}) },
      select: profileSelect,
    })
    return { profile, created: true }
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
    const profile = await db.customerProfile.findUnique({ where: { userId: user.id }, select: profileSelect })
    if (!profile) throw e
    return { profile, created: false }
  }
}

/** Newsletter opt-in from sign-up (VAREL `source: 'signup'`). Never unsubscribes; an existing row is kept. */
export async function applyNewsletterOptIn(db: Db, userId: number, email: string): Promise<void> {
  const address = email.trim().toLowerCase()
  await db.newsletterSubscriber.upsert({
    where: { email: address },
    create: { email: address, source: 'signup' },
    update: {},
    select: { id: true },
  })
  await db.customerProfile.updateMany({ where: { userId, marketingOptIn: false }, data: { marketingOptIn: true } })
}

/** Remember the customer's language; writes only when it changed (VAREL `PATCH /account/locale`). */
export async function rememberLocale(db: Db, user: { id: number; name: string | null }, locale: string): Promise<void> {
  const { created } = await ensureCustomerProfile(db, user, { locale })
  if (!created) await db.customerProfile.updateMany({ where: { userId: user.id, NOT: { locale } }, data: { locale } })
}

/** Accounts younger than this get the welcome email when their profile is first made. */
export const WELCOME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** A new account (not an old staff or owner account signing in on the storefront for the first time). */
export function isNewAccount(createdAt: Date | null | undefined, now = Date.now()): boolean {
  return !!createdAt && now - createdAt.getTime() <= WELCOME_WINDOW_MS
}
