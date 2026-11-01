/* Port of VAREL worker/lib/payments/simulated.ts (verbatim). Simulated card payments (local dev, demos, and the fallback whenever STRIPE_SECRET_KEY is not set).
   The card is checked (Luhn, expiry, CVC) and the order is paid on the spot. Only brand and last 4 digits are stored. */

export const DECLINED_CARD = '4000000000000002'

export const digitsOnly = (s: string) => s.replace(/[\s-]/g, '')

export function luhn(num: string): boolean {
  if (!/^\d{12,19}$/.test(num)) return false
  let sum = 0
  let dbl = false
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

export function cardBrand(num: string): string {
  if (/^4/.test(num)) return 'Visa'
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard'
  if (/^3[47]/.test(num)) return 'American Express'
  if (/^(6011|65|64[4-9])/.test(num)) return 'Discover'
  return 'Card'
}

/** "MM/YY" or "MM/YYYY" → valid through the end of that month. */
export function expiryInFuture(expiry: string, now = new Date()): boolean {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(expiry)
  if (!m) return false
  const month = Number(m[1])
  let year = Number(m[2])
  if (month < 1 || month > 12) return false
  if (year < 100) year += 2000
  const endOfMonth = new Date(Date.UTC(year, month, 1)) // first instant of the following month
  return endOfMonth.getTime() > now.getTime()
}

export interface CardInput {
  name: string
  number: string
  expiry: string
  cvc: string
}

/** Field errors keyed like the request body (payment.number …). Empty when the card looks valid. */
export function validateCard(card: CardInput): Record<string, string> {
  const fields: Record<string, string> = {}
  const number = digitsOnly(card.number)
  if (!card.name.trim()) fields['payment.name'] = 'Enter the name on the card'
  if (!number) fields['payment.number'] = 'Enter your card number'
  else if (!luhn(number)) fields['payment.number'] = 'Check the card number'
  if (!card.expiry.trim()) fields['payment.expiry'] = 'Enter the expiry date'
  else if (!expiryInFuture(card.expiry)) fields['payment.expiry'] = 'Use a card that has not expired (MM/YY)'
  if (!/^\d{3,4}$/.test(card.cvc.trim())) fields['payment.cvc'] = 'Enter the 3 or 4 digit security code'
  return fields
}

export type SimulatedCharge =
  | { ok: true; brand: string; last4: string }
  | { ok: false; status: 402 | 422; code: string; message: string; fields?: Record<string, string> }

/** Charge a card: validates it and declines the test card 4000 0000 0000 0002. */
export function simulateCharge(card: CardInput | undefined): SimulatedCharge {
  if (!card) return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'Enter your card details', fields: { payment: 'Enter your card details' } }
  const fields = validateCard(card)
  if (Object.keys(fields).length) return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'Check your card details', fields }
  const number = digitsOnly(card.number)
  if (number === DECLINED_CARD) {
    return { ok: false, status: 402, code: 'PAYMENT_DECLINED', message: 'Your card was declined. Try another card or contact your bank' }
  }
  return { ok: true, brand: cardBrand(number), last4: number.slice(-4) }
}
