/* Checkout rules from settings (port of VAREL worker/lib/checkout-rules.ts; docs/PHASE2-3.md §1), enforced server side:
   - guestCheckout=false → 401 SIGN_IN_REQUIRED for guests;
   - requirePhone → phone is required;
   - orderNotes → customerNote (≤ 500 characters) is kept, otherwise ignored;
   - termsText not empty → acceptTerms: true is required.
   Used by POST /site-api/checkout: spread `checkoutRuleFields` into the body schema and call `applyCheckoutRules`. */
import { z } from 'zod'
import type { Db } from './db'
import { HttpError, invalid } from './errors'
import { getSettings, type StoreSettings } from './settings'

/** Additive CheckoutRequest fields: `customerNote?`, `acceptTerms?`. */
export const checkoutRuleFields = {
  customerNote: z
    .string({ error: 'Check your order note' })
    .trim()
    .max(500, 'Keep your note under 500 characters')
    .optional()
    .transform((v) => v || null),
  acceptTerms: z.boolean({ error: 'Check this field' }).optional().default(false),
}

export interface CheckoutRuleInput {
  phone?: string | null
  customerNote?: string | null
  acceptTerms?: boolean
}

/** Throws when the store's checkout rules are not met; returns what to store on the order. */
export function checkCheckoutRules(
  s: Pick<StoreSettings, 'guestCheckout' | 'requirePhone' | 'termsText' | 'orderNotes'>,
  user: { id: number | string } | null,
  input: CheckoutRuleInput,
): { customerNote: string | null } {
  if (!s.guestCheckout && !user) throw new HttpError(401, 'SIGN_IN_REQUIRED', 'Sign in to check out')
  const fields: Record<string, string> = {}
  if (s.requirePhone && !input.phone?.trim()) fields.phone = 'Enter a phone number for delivery'
  if (s.termsText.trim() && input.acceptTerms !== true) fields.acceptTerms = 'Accept the terms to continue'
  if (Object.keys(fields).length) throw invalid(fields)
  return { customerNote: s.orderNotes ? (input.customerNote?.trim() || null) : null }
}

/** Loads the settings and checks the rules (see checkCheckoutRules). */
export async function applyCheckoutRules(db: Db, user: { id: number | string } | null, input: CheckoutRuleInput) {
  return checkCheckoutRules(await getSettings(db), user, input)
}
