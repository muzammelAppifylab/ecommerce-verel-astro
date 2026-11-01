/* Money (port of VAREL worker/lib/money.ts).

   The database keeps money as integer cents (`Int` columns + `currency Char(3)`, PLAN.md F1); the API contract,
   the promotions engine and totals keep VAREL's numbers in the store currency rounded to cents (148, 24.6).
   Convert at the database boundary only: `fromCents(row.priceCents)` when reading, `toCents(amount)` when writing.
   `num()` stays for values that are already in currency units (numbers, numeric strings, Decimal-like objects). */

/** Anything with a numeric `toString()` (a Prisma Decimal), a number or a numeric string. */
export type DecimalLike = { toString(): string } | number | string

/** Round to cents. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Currency units (number / Decimal / numeric string / null) → number rounded to cents. */
export function num(v: DecimalLike | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v.toString())
  return Number.isFinite(n) ? round2(n) : 0
}

export function numOrNull(v: DecimalLike | null | undefined): number | null {
  return v == null ? null : num(v)
}

/** Integer cents from the database → currency units (1480 → 14.8). */
export function fromCents(cents: number | bigint | null | undefined): number {
  if (cents == null) return 0
  return round2(Number(cents) / 100)
}

export function fromCentsOrNull(cents: number | bigint | null | undefined): number | null {
  return cents == null ? null : fromCents(cents)
}

/** Currency units → integer cents for the database (14.8 → 1480). Rounds half away from zero at the cent. */
export function toCents(amount: number): number {
  return Math.round(amount * 100 + (amount >= 0 ? 1e-7 : -1e-7))
}

export function toCentsOrNull(amount: number | null | undefined): number | null {
  return amount == null ? null : toCents(amount)
}

/** Basis points (2500) ↔ rate (0.25), for tax rates stored as integers. */
export const fromBasisPoints = (bp: number | null | undefined): number => (bp == null ? 0 : Math.round(bp) / 10_000)
export const toBasisPoints = (rate: number): number => Math.round(rate * 10_000)

// ─── Currency formatting ────────────────────────────────────────────────────

/** Locale per currency so amounts read naturally: "$148", "€148", "£148", "148 kr.". Others use en-US. */
const LOCALE: Record<string, string> = { DKK: 'da-DK', SEK: 'sv-SE', NOK: 'nb-NO', ISK: 'is-IS' }

/* The store currency (Setting.currency). getSettings() keeps it current; one store, one currency.
   Module memory holds only this public, three-letter value (AGENTS.md: small public caches only). */
let storeCurrency = 'USD'

export function setStoreCurrency(code: string): void {
  if (isCurrencyCode(code)) storeCurrency = code.toUpperCase()
}

export const getStoreCurrency = () => storeCurrency

/** A 3-letter ISO 4217 code that Intl knows. */
const known = new Map<string, boolean>()
export function isCurrencyCode(code: string): boolean {
  if (typeof code !== 'string' || !/^[A-Za-z]{3}$/.test(code)) return false
  const c = code.toUpperCase()
  let ok = known.get(c)
  if (ok === undefined) {
    try {
      new Intl.NumberFormat('en-US', { style: 'currency', currency: c })
      ok = true
    } catch {
      ok = false
    }
    known.set(c, ok)
  }
  return ok
}

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, fraction: boolean): Intl.NumberFormat {
  const key = `${currency}:${fraction}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE[currency] ?? 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction ? 2 : 0,
      maximumFractionDigits: 2,
    })
    formatters.set(key, f)
  }
  return f
}

/** "$148", "$24.60", "€1,240", "148 kr." — whole amounts without decimals, two decimals when fractional.
    Defaults to the store currency. */
export function money(n: number, currency: string = storeCurrency): string {
  const v = round2(Number(n))
  const code = isCurrencyCode(currency) ? currency.toUpperCase() : 'USD'
  return formatter(code, !Number.isInteger(v)).format(v)
}
