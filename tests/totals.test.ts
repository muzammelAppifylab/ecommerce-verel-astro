/* Bag/order totals (worker/lib/totals.ts): tax modes, country rates, taxShipping, taxDigital, discounts, rounding.
   Rules: docs/PHASE2-3.md §1 "Totals". */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { computeTotals, includedTax, ratePercent, taxableMerchandise, type TaxOptions, type TotalsLine } from '../src/server/lib/totals'
import { money } from '../src/server/lib/money'
import { checkCheckoutRules } from '../src/server/lib/checkout-rules'
import { lineRefund, shippingRefund } from '../src/server/lib/orders'
import type { EngineResult } from '../src/server/lib/promotions-types'
import type { StoreSettings } from '../src/server/lib/settings'

const eq = (actual: number, expected: number) => assert.equal(Math.round(actual * 100) / 100, expected)
const line = (total: number, over: Partial<TotalsLine> = {}): TotalsLine => ({ total, qty: 1, digital: false, ...over })
const promo = (discountTotal: number, freeShipping = false): EngineResult =>
  ({ applied: [], rejected: null, discountTotal, freeShipping, lineDiscounts: {} }) as unknown as EngineResult

const exclusive = (rate = 0.25, over: Partial<TaxOptions> = {}): TaxOptions => ({ rate, name: 'VAT', ...over })
const inclusive = (rate = 0.25, over: Partial<TaxOptions> = {}): TaxOptions => ({ rate, name: 'VAT', pricesIncludeTax: true, ...over })

describe('exclusive tax (default)', () => {
  it('adds tax on merchandise, as before', () => {
    const t = computeTotals([line(118.4)], { shippingRate: 12 })
    eq(t.subtotal, 118.4)
    eq(t.shipping, 12)
    eq(t.tax, 29.6)
    eq(t.total, 160)
    assert.equal(t.pricesIncludeTax, false)
    assert.equal(t.taxRate, 0.25)
    assert.equal(t.taxLabel, 'VAT 25%')
    assert.equal(t.shippingLabel, '$12')
  })
  it('taxes merchandise after discounts', () => {
    const t = computeTotals([line(200)], { promotions: promo(20), tax: exclusive() })
    eq(t.discount, 20)
    eq(t.tax, 45)
    eq(t.total, 225) // 180 + 45, free shipping over the threshold
  })
  it('does not tax shipping unless taxShipping is on', () => {
    const off = computeTotals([line(100)], { shippingRate: 20, tax: exclusive() })
    eq(off.tax, 25)
    eq(off.total, 145)
    const on = computeTotals([line(100)], { shippingRate: 20, tax: exclusive(0.25, { taxShipping: true }) })
    eq(on.tax, 30)
    eq(on.total, 150)
  })
  it('free shipping leaves no shipping tax', () => {
    const t = computeTotals([line(100)], { shippingRate: 20, promotions: promo(0, true), tax: exclusive(0.25, { taxShipping: true }) })
    eq(t.shipping, 0)
    eq(t.tax, 25)
  })
  it('labels fractional rates', () => {
    assert.equal(computeTotals([line(10)], { tax: exclusive(0.0825, { name: 'Sales tax' }) }).taxLabel, 'Sales tax 8.25%')
    assert.equal(ratePercent(0.19), '19')
  })
  it('a zero rate adds nothing', () => {
    const t = computeTotals([line(99.99)], { shippingRate: 5, tax: exclusive(0) })
    eq(t.tax, 0)
    eq(t.total, 104.99)
  })
})

describe('inclusive tax', () => {
  it('extracts tax and adds nothing to the total', () => {
    const t = computeTotals([line(148)], { shippingRate: 12, tax: inclusive() })
    eq(t.tax, 29.6) // 148 − 148 / 1.25
    eq(t.total, 160)
    assert.equal(t.pricesIncludeTax, true)
    assert.equal(t.taxLabel, 'Includes $29.60 VAT')
  })
  it('extracts tax from the discounted merchandise', () => {
    const t = computeTotals([line(200)], { promotions: promo(25), tax: inclusive() })
    eq(t.tax, 35) // 175 − 140
    eq(t.total, 175)
  })
  it('extracts shipping tax only when taxShipping is on', () => {
    const off = computeTotals([line(100)], { shippingRate: 25, tax: inclusive() })
    eq(off.tax, 20)
    eq(off.total, 125)
    const on = computeTotals([line(100)], { shippingRate: 25, tax: inclusive(0.25, { taxShipping: true }) })
    eq(on.tax, 25)
    eq(on.total, 125)
  })
  it('formats the label in the store currency', () => {
    const t = computeTotals([line(148)], { tax: inclusive(), currency: 'EUR' })
    assert.equal(t.taxLabel, 'Includes €29.60 VAT')
  })
})

describe('country rates', () => {
  it('a Germany 19% rate (inclusive)', () => {
    const t = computeTotals([line(119)], { tax: inclusive(0.19) })
    eq(t.tax, 19)
    eq(t.total, 119)
    assert.equal(t.taxRate, 0.19)
  })
  it('a Germany 19% rate (exclusive)', () => {
    const t = computeTotals([line(100)], { shippingRate: 10, tax: exclusive(0.19) })
    eq(t.tax, 19)
    eq(t.total, 129)
  })
  it('the same bag differs only in tax between Denmark 25% and Germany 19% (exclusive)', () => {
    const dk = computeTotals([line(80)], { shippingRate: 10, tax: exclusive(0.25) })
    const de = computeTotals([line(80)], { shippingRate: 10, tax: exclusive(0.19) })
    eq(dk.total - de.total, 4.8)
  })
})

describe('digital lines', () => {
  const lines = [line(100), line(20, { digital: true })]
  it('are taxed by default', () => {
    eq(computeTotals(lines, { tax: exclusive() }).tax, 30)
  })
  it('are excluded when taxDigital is false (exclusive)', () => {
    const t = computeTotals(lines, { tax: exclusive(0.25, { taxDigital: false }) })
    eq(t.tax, 25)
    eq(t.total, 145)
  })
  it('are excluded when taxDigital is false (inclusive)', () => {
    const t = computeTotals(lines, { tax: inclusive(0.25, { taxDigital: false }) })
    eq(t.tax, 20)
    eq(t.total, 120)
  })
  it('a digital-only bag has no shipping and no tax without taxDigital', () => {
    const t = computeTotals([line(0, { digital: true }), line(12, { digital: true })], { shippingRate: 12, tax: exclusive(0.25, { taxDigital: false }) })
    eq(t.shipping, 0)
    eq(t.tax, 0)
    assert.equal(t.shippingLabel, 'No shipping · digital')
  })
  it('uses line discounts when given, else shares the discount pro rata', () => {
    const explicit = [line(100, { discount: 10 }), line(50, { digital: true, discount: 20 })]
    eq(taxableMerchandise(explicit, 30, false), 90)
    eq(taxableMerchandise([line(100), line(50, { digital: true })], 30, false), 80)
  })
})

describe('rounding', () => {
  it('rounds tax to cents (exclusive)', () => {
    eq(computeTotals([line(33.33)], { tax: exclusive() }).tax, 8.33)
    eq(computeTotals([line(0.05)], { tax: exclusive() }).tax, 0.01)
  })
  it('rounds extracted tax to cents (inclusive)', () => {
    eq(includedTax(10, 0.25), 2)
    eq(includedTax(9.99, 0.19), 1.6)
    eq(computeTotals([line(9.99), line(0.01)], { tax: inclusive(0.19) }).tax, 1.6)
  })
  it('the total is subtotal − discount + shipping + tax to the cent', () => {
    const t = computeTotals([line(57.35, { qty: 3 }), line(19.99)], { shippingRate: 7.45, promotions: promo(13.37), tax: exclusive(0.0825, { taxShipping: true }) })
    eq(t.total, Math.round((t.subtotal - t.discount + t.shipping + t.tax) * 100) / 100)
    eq(t.tax, 5.89) // round2(63.97 × 8.25%) = 5.28, plus round2(7.45 × 8.25%) = 0.61
  })
  it('a discount never takes the subtotal below zero', () => {
    const t = computeTotals([line(10)], { promotions: promo(50), tax: exclusive() })
    eq(t.discount, 10)
    eq(t.tax, 0)
    eq(t.total, 0)
  })
})

describe('money', () => {
  it('formats whole amounts without decimals in the store style', () => {
    assert.equal(money(148, 'USD'), '$148')
    assert.equal(money(1240, 'USD'), '$1,240')
    assert.equal(money(24.6, 'USD'), '$24.60')
    assert.equal(money(148, 'EUR'), '€148')
    assert.equal(money(148, 'GBP'), '£148')
    assert.equal(money(148, 'DKK').replace(/\s/g, ' '), '148 kr.')
  })
  it('falls back to USD for an unknown code', () => {
    assert.equal(money(5, 'nope'), '$5')
  })
})

describe('refunds', () => {
  it('exclusive orders give back the line plus its tax at the snapshotted rate', () => {
    const order = { subtotal: 200, discount: 0, tax: 55, taxRate: 0.25 } // tax includes shipping tax
    eq(lineRefund(order, { price: 100, qty: 1, discount: 0 }, 1), 125)
  })
  it('inclusive orders give back the line price only', () => {
    const order = { subtotal: 200, discount: 0, tax: 40, pricesIncludeTax: true, taxRate: 0.25 }
    eq(lineRefund(order, { price: 100, qty: 2, discount: 20 }, 1), 90)
  })
  it('older orders without a rate keep the proportional share', () => {
    eq(lineRefund({ subtotal: 100, discount: 0, tax: 25 }, { price: 50, qty: 2, discount: 0 }, 1), 62.5)
  })
  it('shipping is refunded on a full return only with refundShipping', () => {
    const s = { refundShipping: true, taxShipping: false, taxRate: 0.25 }
    eq(shippingRefund({ shipping: 12 }, s), 12)
    eq(shippingRefund({ shipping: 12, taxRate: 0.25 }, { ...s, taxShipping: true }), 15)
    eq(shippingRefund({ shipping: 12, pricesIncludeTax: true }, { ...s, taxShipping: true }), 12)
    eq(shippingRefund({ shipping: 12 }, { ...s, refundShipping: false }), 0)
  })
})

describe('checkout rules', () => {
  const base = { guestCheckout: true, requirePhone: false, orderNotes: false, termsText: '' } as StoreSettings
  const code = (fn: () => unknown) => {
    try {
      fn()
      return null
    } catch (e) {
      return (e as { code: string; fields?: Record<string, string> }).code + ':' + Object.keys((e as { fields?: object }).fields ?? {}).join(',')
    }
  }
  it('lets guests check out by default and drops notes when notes are off', () => {
    assert.deepEqual(checkCheckoutRules(base, null, { customerNote: 'Leave at the door' }), { customerNote: null })
  })
  it('requires sign-in when guest checkout is off', () => {
    assert.equal(code(() => checkCheckoutRules({ ...base, guestCheckout: false }, null, {})), 'SIGN_IN_REQUIRED:')
    assert.equal(code(() => checkCheckoutRules({ ...base, guestCheckout: false }, { id: 'u1' }, {})), null)
  })
  it('requires a phone and accepted terms when set', () => {
    const s = { ...base, requirePhone: true, termsText: 'I accept the terms of sale' }
    assert.equal(code(() => checkCheckoutRules(s, null, {})), 'VALIDATION_ERROR:phone,acceptTerms')
    assert.equal(code(() => checkCheckoutRules(s, null, { phone: '+45 1234', acceptTerms: true })), null)
  })
  it('keeps the note when order notes are on', () => {
    assert.deepEqual(checkCheckoutRules({ ...base, orderNotes: true }, null, { customerNote: ' Gift wrap ' }), { customerNote: 'Gift wrap' })
  })
})
