/* Client rules of the account forms: the server's validation mirrored (src/server/routes/account.ts and the
   template's /site-api/auth/* routes). Pure: each returns `{field: translationKey}` for the wrong fields, so the
   screens translate and the unit tests read them without React. */
import { passwordChecks } from '@/lib/password-checks'
import { PASSWORD_LIMITS } from '@/platform/auth/password'

export type Problems<F extends string> = Partial<Record<F, string>>

const blank = (v: string | null | undefined) => !v || !v.trim()

export type ProfileFieldName = 'firstName' | 'lastName' | 'phone'

/** PATCH /account/profile: names required ≤ 80, phone ≤ 40. Keys in `account`. */
export function profileProblems(f: { firstName: string; lastName: string; phone: string }): Problems<ProfileFieldName> {
  const out: Problems<ProfileFieldName> = {}
  if (blank(f.firstName)) out.firstName = 'profile.errors.firstName'
  else if (f.firstName.trim().length > 80) out.firstName = 'profile.errors.firstNameLong'
  if (blank(f.lastName)) out.lastName = 'profile.errors.lastName'
  else if (f.lastName.trim().length > 80) out.lastName = 'profile.errors.lastNameLong'
  if (f.phone.trim().length > 40) out.phone = 'profile.errors.phoneLong'
  return out
}

export type PasswordFieldName = 'currentPassword' | 'newPassword' | 'confirm'

/** POST /auth/change-password: current required; new 10–128, not containing the email's name; confirm equal. */
export function passwordProblems(
  f: { currentPassword: string; newPassword: string; confirm: string },
  email = '',
): Problems<PasswordFieldName> {
  const out: Problems<PasswordFieldName> = {}
  if (!f.currentPassword) out.currentPassword = 'password.errors.current'
  const checks = passwordChecks(f.newPassword, email)
  if (f.newPassword.length > PASSWORD_LIMITS.max) out.newPassword = 'password.errors.tooLong'
  else if (!checks.find((c) => c.id === 'length')?.ok) out.newPassword = 'password.errors.length'
  else if (checks.some((c) => c.id === 'email' && !c.ok)) out.newPassword = 'password.errors.email'
  else if (f.confirm !== f.newPassword) out.confirm = 'password.errors.match'
  return out
}

export type EmailFieldName = 'email' | 'password'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** POST /auth/email: a real-looking address ≤ 254, not the current one; the password when the account has one. */
export function emailProblems(f: { email: string; password: string }, current: string, hasPassword: boolean): Problems<EmailFieldName> {
  const out: Problems<EmailFieldName> = {}
  const email = f.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) out.email = 'email.errors.email'
  else if (email === current.trim().toLowerCase()) out.email = 'email.errors.same'
  if (hasPassword && !f.password) out.password = 'email.errors.password'
  return out
}

export type AddressFieldName = 'label' | 'name' | 'line1' | 'line2' | 'zip' | 'city' | 'country' | 'phone'

const ADDRESS_MAX: Record<AddressFieldName, number> = {
  label: 40,
  name: 120,
  line1: 200,
  line2: 200,
  zip: 20,
  city: 100,
  country: 80,
  phone: 40,
}
const ADDRESS_REQUIRED: AddressFieldName[] = ['name', 'line1', 'zip', 'city', 'country']

/** POST/PATCH /account/addresses. Keys in `account` (`dialog.errors.*`; `dialog.errors.tooLong` with {max}). */
export function addressProblems(f: Record<AddressFieldName, string>): Problems<AddressFieldName> {
  const out: Problems<AddressFieldName> = {}
  for (const k of Object.keys(ADDRESS_MAX) as AddressFieldName[]) {
    const v = (f[k] ?? '').trim()
    if (ADDRESS_REQUIRED.includes(k) && !v) out[k] = `dialog.errors.${k}`
    else if (v.length > ADDRESS_MAX[k]) out[k] = 'dialog.errors.tooLong'
  }
  return out
}

export const addressMax = (k: AddressFieldName) => ADDRESS_MAX[k]

/** POST /account/delete: the password when the account has one; DELETE typed in capitals. */
export function deleteProblems(f: { password: string; confirm: string }, hasPassword: boolean): Problems<'password' | 'confirm'> {
  const out: Problems<'password' | 'confirm'> = {}
  if (hasPassword && !f.password) out.password = 'privacy.delete.enterPassword'
  if (f.confirm.trim() !== 'DELETE') out.confirm = 'privacy.delete.errors.confirm'
  return out
}

/** The first wrong field in form order, to focus it. */
export function firstProblem<F extends string>(order: readonly F[], problems: Problems<F>): F | undefined {
  return order.find((k) => problems[k])
}
