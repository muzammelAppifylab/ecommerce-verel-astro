/* Free-shipping threshold measured after discounts (docs/PROMOTIONS.md, rule 5 and "Free shipping"):
   the engine compares sets on what the customer pays, and totals charge shipping below the threshold after discounts. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { appliedIds, automatic, discount, expectRejected, input, line, run } from './promotions-helpers'
import { computeTotals, shippingValue, type TotalsLine } from '../src/server/lib/totals'
import type { EngineResult } from '../src/server/lib/promotions-types'

const totalsLine = (total: number, over: Partial<TotalsLine> = {}): TotalsLine => ({ total, qty: 1, digital: false, ...over })
const promo = (discountTotal: number, freeShipping = false): EngineResult =>
  ({ applied: [], rejected: null, discountTotal, freeShipping, lineDiscounts: {} }) as unknown as EngineResult

describe('engine: free-shipping threshold after discounts', () => {
  it('free shipping is worth nothing when the bag ships free after its discounts', () => {
    // $200 bag, threshold $150: a 10% automatic leaves $180 (ships free), so FREESHIP saves nothing and loses.
    const auto = automatic({ value: 10 })
    const code = discount({ kind: 'shipping', value: 0, code: 'FREESHIP' })
    const r = run(input({ code, codeEntered: 'FREESHIP', automatic: [auto], lines: [line({ unit: 200 })], shippingRate: 12, freeThreshold: 150 }))
    assert.deepEqual(appliedIds(r), [auto.id])
    expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
  })

  it('a discount that drops the bag under the threshold counts the shipping it brings back', () => {
    // $160 bag, threshold $150, $42 shipping. 10% off saves $16 but costs $42 shipping (net −$26);
    // FREESHIP saves nothing either way, but its set keeps shipping free: it wins.
    const auto = automatic({ value: 10 })
    const code = discount({ kind: 'shipping', value: 0, code: 'FREESHIP' })
    const r = run(input({ code, codeEntered: 'FREESHIP', automatic: [auto], lines: [line({ unit: 160 })], shippingRate: 42, freeThreshold: 150 }))
    assert.deepEqual(appliedIds(r), [code.id])
    assert.equal(r.rejected, null)
  })

  it('below the threshold free shipping is worth the full rate', () => {
    const auto = automatic({ value: 10 }) // $5 off a $50 bag
    const code = discount({ kind: 'shipping', value: 0, code: 'FREESHIP' })
    const r = run(input({ code, codeEntered: 'FREESHIP', automatic: [auto], lines: [line({ unit: 50 })], shippingRate: 8, freeThreshold: 150 }))
    assert.deepEqual(appliedIds(r), [code.id])
  })

  it('an automatic discount that would cost more in shipping than it saves is not applied', () => {
    // $160 bag, $42 shipping: 10% off ($16) would bring it under $150 and add $42 shipping.
    const auto = automatic({ value: 10 })
    const r = run(input({ automatic: [auto], lines: [line({ unit: 160 })], shippingRate: 42, freeThreshold: 150 }))
    assert.deepEqual(appliedIds(r), [])
    assert.equal(r.discountTotal, 0)
  })

  it('an automatic discount still applies when it saves more than the shipping it adds', () => {
    // $160 bag, $12 shipping: 10% off saves $16, shipping adds $12; the customer pays $4 less.
    const auto = automatic({ value: 10 })
    const r = run(input({ automatic: [auto], lines: [line({ unit: 160 })], shippingRate: 12, freeThreshold: 150 }))
    assert.deepEqual(appliedIds(r), [auto.id])
  })

  it('without a threshold, a small discount still beats nothing when shipping exceeds it', () => {
    // Free shipping is valued at the rate; a $5 automatic alone must still apply (values below zero compare too).
    const auto = automatic({ value: 10 })
    const r = run(input({ automatic: [auto], lines: [line({ unit: 50 })], shippingRate: 8 }))
    assert.deepEqual(appliedIds(r), [auto.id])
  })

  it('digital-only bags never value free shipping when a threshold is given', () => {
    const auto = automatic({ value: 10 })
    const code = discount({ kind: 'shipping', value: 0, code: 'FREESHIP' })
    const r = run(input({ code, codeEntered: 'FREESHIP', automatic: [auto], lines: [line({ unit: 50, digital: true })], shippingRate: 8, freeThreshold: 150 }))
    assert.deepEqual(appliedIds(r), [auto.id])
  })
})

describe('totals: free-shipping threshold after discounts', () => {
  it('charges shipping when discounts bring the bag under the threshold', () => {
    const t = computeTotals([totalsLine(160)], { promotions: promo(16), shippingRate: 12, freeThreshold: 150 })
    assert.equal(t.shipping, 12)
    assert.equal(t.toFree, 6)
  })

  it('ships free when the bag stays at or over the threshold after discounts', () => {
    const t = computeTotals([totalsLine(200)], { promotions: promo(50), shippingRate: 12, freeThreshold: 150 })
    assert.equal(t.shipping, 0)
    assert.equal(t.toFree, 0)
  })

  it('shippingValue: what free shipping saves after the other discounts', () => {
    assert.equal(shippingValue([totalsLine(160)], 12, 150, 16), 12)
    assert.equal(shippingValue([totalsLine(160)], 12, 150, 0), 0)
    assert.equal(shippingValue([totalsLine(50, { digital: true })], 12, 150, 0), 0)
  })
})

describe('engine: first order', () => {
  it('a customer with an earlier paid (or since refunded) order is not eligible', () => {
    // The loader counts Paid and Refunded orders into paidOrders; one is enough to fail first_order.
    const code = discount({ eligibility: 'first_order', code: 'FIRST25', kind: 'fixed', value: 25 })
    const r = run(input({ code, codeEntered: 'FIRST25', lines: [line({ unit: 300 })], stage: 'checkout', customer: { id: 'c', email: 'a@b.co', signedIn: true, paidOrders: 1, subscriber: false, redemptions: {} } }))
    expectRejected(r, 'DISCOUNT_NOT_ELIGIBLE')
  })
})
