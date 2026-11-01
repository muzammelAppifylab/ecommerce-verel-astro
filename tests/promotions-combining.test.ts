/* Engine rule 5: combining discounts, priority order, code vs automatic comparison. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { appliedIds, automatic, discount, expectRejected, find, input, line, money, run } from './promotions-helpers'

const NOT_COMBINABLE_MSG = 'A better offer is already applied to your bag'
const bag100 = [line({ lineId: 'x', unit: 100 })]
const bag200 = [line({ lineId: 'x', unit: 200 })]

describe('combining', () => {
  it('two combinable automatics both apply in priority order; the second works on what is left', () => {
    const lo = automatic({ value: 20, combinable: true, priority: 5 })
    const hi = automatic({ value: 10, combinable: true, priority: 10 })
    const r = run(input({ automatic: [lo, hi], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [hi.id, lo.id])
    money(find(r, hi.id).amount, 10)
    money(find(r, lo.id).amount, 18) // 20% of the remaining 90
    money(r.discountTotal, 28)
    money(r.lineDiscounts.x, 28)
  })

  it('a non-combinable automatic applies alone (higher priority, bigger saving)', () => {
    const solo = automatic({ value: 20, combinable: false, priority: 10 })
    const other = automatic({ value: 10, combinable: true, priority: 5 })
    const r = run(input({ automatic: [other, solo], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [solo.id])
    money(r.discountTotal, 20)
  })

  // Rule 5: sets are {each non-combinable alone} and {all combinables}; {first}=10 beats {solo}=5.
  it('a non-combinable automatic never joins a combinable one; the better set wins', () => {
    const first = automatic({ value: 10, combinable: true, priority: 10 })
    const solo = automatic({ value: 5, combinable: false, priority: 5 })
    const r = run(input({ automatic: [solo, first], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [first.id])
    money(r.discountTotal, 10)
  })

  it('code vs non-combinable automatic: automatic saves more -> code rejected DISCOUNT_NOT_COMBINABLE', () => {
    const auto = automatic({ value: 15, priority: 10 })
    const code = discount({ value: 10 })
    const r = run(input({ code, automatic: [auto], lines: bag200 }))
    assert.deepEqual(appliedIds(r), [auto.id])
    money(r.discountTotal, 30)
    expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
    assert.equal(r.rejected?.message, NOT_COMBINABLE_MSG)
  })

  it('code vs non-combinable automatic: code saves more -> code applies alone', () => {
    const auto = automatic({ value: 15, priority: 10 })
    const code = discount({ kind: 'fixed', value: 50 })
    const r = run(input({ code, automatic: [auto], lines: bag200 }))
    assert.deepEqual(appliedIds(r), [code.id])
    money(r.discountTotal, 50)
    assert.equal(r.rejected, null)
  })

  it('a combinable code still cannot join a non-combinable automatic (code better)', () => {
    const auto = automatic({ value: 10, combinable: false, priority: 10 })
    const code = discount({ value: 15, combinable: true })
    const r = run(input({ code, automatic: [auto], lines: bag200 }))
    assert.deepEqual(appliedIds(r), [code.id])
    money(r.discountTotal, 30)
    assert.equal(r.rejected, null)
  })

  it('a combinable code still cannot join a non-combinable automatic (automatic better)', () => {
    const auto = automatic({ value: 10, combinable: false, priority: 10 })
    const code = discount({ value: 5, combinable: true })
    const r = run(input({ code, automatic: [auto], lines: bag200 }))
    assert.deepEqual(appliedIds(r), [auto.id])
    expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
  })

  it('a non-combinable code never stacks with combinable automatics', () => {
    const auto = automatic({ value: 5, combinable: true, priority: 10 })
    const code = discount({ value: 20, combinable: false })
    const r = run(input({ code, automatic: [auto], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [code.id])
    money(r.discountTotal, 20)
    assert.equal(r.rejected, null)
  })

  it('free-shipping code wins when the shipping rate is worth more', () => {
    const auto = automatic({ value: 10, priority: 10 }) // $5 on $50
    const code = discount({ kind: 'shipping', value: 0, code: 'FREESHIP' })
    const r = run(input({ code, codeEntered: 'FREESHIP', automatic: [auto], lines: [line({ unit: 50 })], shippingRate: 8 }))
    assert.deepEqual(appliedIds(r), [code.id])
    assert.equal(r.freeShipping, true)
    money(r.discountTotal, 0)
    assert.equal(r.rejected, null)
  })

  it('free-shipping code loses when the shipping rate is worth less', () => {
    const auto = automatic({ value: 10, priority: 10 })
    const code = discount({ kind: 'shipping', value: 0, code: 'FREESHIP' })
    const r = run(input({ code, codeEntered: 'FREESHIP', automatic: [auto], lines: [line({ unit: 50 })], shippingRate: 3 }))
    assert.deepEqual(appliedIds(r), [auto.id])
    assert.equal(r.freeShipping, false)
    money(r.discountTotal, 5)
    expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
  })

  it('free shipping is valued at 0 when no shipping method is selected', () => {
    const auto = automatic({ value: 10, priority: 10 })
    const code = discount({ kind: 'shipping', value: 0 })
    const r = run(input({ code, automatic: [auto], lines: [line({ unit: 50 })], shippingRate: 0 }))
    assert.deepEqual(appliedIds(r), [auto.id])
    expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
  })

  it('combinable free-shipping code stacks with a combinable automatic', () => {
    const auto = automatic({ value: 10, combinable: true, priority: 10 })
    const code = discount({ kind: 'shipping', value: 0, combinable: true })
    const r = run(input({ code, automatic: [auto], lines: [line({ unit: 50 })], shippingRate: 8 }))
    assert.equal(r.applied.length, 2)
    assert.equal(r.freeShipping, true)
    money(r.discountTotal, 5)
    assert.equal(r.rejected, null)
  })

  it('priority tie: code applies before automatic', () => {
    const auto = automatic({ value: 20, combinable: true, priority: 0 })
    const code = discount({ value: 10, combinable: true, priority: 0 })
    const r = run(input({ code, automatic: [auto], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [code.id, auto.id])
    money(find(r, code.id).amount, 10)
    money(find(r, auto.id).amount, 18)
  })

  it('higher-priority automatic applies before a lower-priority code', () => {
    const auto = automatic({ value: 20, combinable: true, priority: 5 })
    const code = discount({ value: 10, combinable: true, priority: 0 })
    const r = run(input({ code, automatic: [auto], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [auto.id, code.id])
    money(find(r, auto.id).amount, 20)
    money(find(r, code.id).amount, 8)
  })

  it('priority tie between automatics: older createdAt first', () => {
    const newer = automatic({ value: 20, combinable: true, createdAt: new Date('2026-05-01T00:00:00Z') })
    const older = automatic({ value: 10, combinable: true, createdAt: new Date('2026-02-01T00:00:00Z') })
    const r = run(input({ automatic: [newer, older], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [older.id, newer.id])
    money(find(r, older.id).amount, 10)
    money(find(r, newer.id).amount, 18)
  })

  it('equal savings between code and non-combinable automatic: the code is kept', () => {
    const auto = automatic({ value: 10, priority: 0 })
    const code = discount({ value: 10, priority: 0 })
    const r = run(input({ code, automatic: [auto], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [code.id])
    assert.equal(r.rejected, null)
  })

  it('combinable code + combinable automatic both apply', () => {
    const auto = automatic({ kind: 'fixed', value: 10, combinable: true, priority: 1 })
    const code = discount({ value: 10, combinable: true })
    const r = run(input({ code, automatic: [auto], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [auto.id, code.id])
    money(find(r, auto.id).amount, 10)
    money(find(r, code.id).amount, 9)
    money(r.discountTotal, 19)
    assert.equal(r.rejected, null)
  })

  it('with-code set (code + compatible automatics) beats a non-combinable automatic', () => {
    const solo = automatic({ value: 15, combinable: false, priority: 10 }) // 15
    const friend = automatic({ value: 10, combinable: true, priority: 5 }) // 10
    const code = discount({ value: 10, combinable: true, priority: 0 }) // 9 after friend
    const r = run(input({ code, automatic: [solo, friend], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [friend.id, code.id])
    money(r.discountTotal, 19)
    assert.equal(r.rejected, null)
  })

  it('non-combinable automatic beats the with-code set when it saves more', () => {
    const solo = automatic({ value: 30, combinable: false, priority: 10 })
    const friend = automatic({ value: 10, combinable: true, priority: 5 })
    const code = discount({ value: 10, combinable: true, priority: 0 })
    const r = run(input({ code, automatic: [solo, friend], lines: bag100 }))
    assert.deepEqual(appliedIds(r), [solo.id])
    money(r.discountTotal, 30)
    expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
  })

  it('a code that fails validity is rejected with that reason, not NOT_COMBINABLE', () => {
    const auto = automatic({ value: 15, priority: 10 })
    const code = discount({ value: 10, minimum: 500 })
    const r = run(input({ code, automatic: [auto], lines: bag200 }))
    expectRejected(r, 'DISCOUNT_MINIMUM')
    assert.deepEqual(appliedIds(r), [auto.id])
  })

  describe('best set wins (rule 5: every allowed set is considered, not greedy by priority)', () => {
    it('non-combinable 10% at priority 10 loses to combinable 20% at priority 1', () => {
      const solo = automatic({ value: 10, combinable: false, priority: 10 })
      const big = automatic({ value: 20, combinable: true, priority: 1 })
      const r = run(input({ automatic: [solo, big], lines: bag100 }))
      assert.deepEqual(appliedIds(r), [big.id])
      money(r.discountTotal, 20)
      assert.equal(r.rejected, null)
    })

    it('two combinables together beat one stronger non-combinable', () => {
      const solo = automatic({ value: 15, combinable: false, priority: 10 })
      const a = automatic({ value: 10, combinable: true, priority: 5 })
      const b = automatic({ value: 10, combinable: true, priority: 1 })
      const r = run(input({ automatic: [solo, b, a], lines: bag100 }))
      assert.deepEqual(appliedIds(r), [a.id, b.id]) // priority order inside the set
      money(find(r, a.id).amount, 10)
      money(find(r, b.id).amount, 9)
      money(r.discountTotal, 19)
    })

    it('one non-combinable beats two weaker combinables together', () => {
      const solo = automatic({ value: 25, combinable: false, priority: 0 })
      const a = automatic({ value: 10, combinable: true, priority: 5 })
      const b = automatic({ value: 10, combinable: true, priority: 1 })
      const r = run(input({ automatic: [a, b, solo], lines: bag100 }))
      assert.deepEqual(appliedIds(r), [solo.id])
      money(r.discountTotal, 25)
    })

    it('a non-combinable code losing to the combinable automatic set -> DISCOUNT_NOT_COMBINABLE', () => {
      const a = automatic({ value: 10, combinable: true, priority: 5 })
      const b = automatic({ value: 10, combinable: true, priority: 1 })
      const code = discount({ value: 15, combinable: false, priority: 20 })
      const r = run(input({ code, automatic: [a, b], lines: bag100 }))
      assert.deepEqual(appliedIds(r), [a.id, b.id])
      money(r.discountTotal, 19)
      expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
      assert.equal(r.rejected?.message, NOT_COMBINABLE_MSG)
    })

    it('a code wins a tie against an equal automatic set', () => {
      const a = automatic({ value: 10, combinable: true, priority: 5 })
      const b = automatic({ value: 10, combinable: true, priority: 1 })
      const code = discount({ kind: 'fixed', value: 19, combinable: false, priority: 0 })
      const r = run(input({ code, automatic: [a, b], lines: bag100 }))
      assert.deepEqual(appliedIds(r), [code.id])
      money(r.discountTotal, 19)
      assert.equal(r.rejected, null)
    })

    it('equal non-code sets: the higher top priority wins', () => {
      const low = automatic({ value: 10, priority: 3, createdAt: new Date('2026-01-01T00:00:00Z') })
      const high = automatic({ value: 10, priority: 7, createdAt: new Date('2026-06-01T00:00:00Z') })
      const r = run(input({ automatic: [low, high], lines: bag100 }))
      assert.deepEqual(appliedIds(r), [high.id])
    })

    it('equal non-code sets with equal priority: the older discount wins', () => {
      const newer = automatic({ kind: 'fixed', value: 10, priority: 2, createdAt: new Date('2026-06-01T00:00:00Z') })
      const older = automatic({ value: 10, priority: 2, createdAt: new Date('2026-01-01T00:00:00Z') })
      const r = run(input({ automatic: [newer, older], lines: bag100 }))
      assert.deepEqual(appliedIds(r), [older.id])
    })

    it('free shipping valued at shippingRate decides between automatics (rate above)', () => {
      const ship = automatic({ kind: 'shipping', value: 0, priority: 0 })
      const pct = automatic({ value: 10, priority: 10 }) // $5 on $50
      const r = run(input({ automatic: [pct, ship], lines: [line({ unit: 50 })], shippingRate: 6 }))
      assert.deepEqual(appliedIds(r), [ship.id])
      assert.equal(r.freeShipping, true)
      money(r.discountTotal, 0)
    })

    it('free shipping valued at shippingRate decides between automatics (rate below)', () => {
      const ship = automatic({ kind: 'shipping', value: 0, priority: 10 })
      const pct = automatic({ value: 10, priority: 0 })
      const r = run(input({ automatic: [pct, ship], lines: [line({ unit: 50 })], shippingRate: 4 }))
      assert.deepEqual(appliedIds(r), [pct.id])
      assert.equal(r.freeShipping, false)
      money(r.discountTotal, 5)
    })
  })

  describe('minimums use original in-scope prices (rule 5)', () => {
    it('a code with a $100 minimum still applies after a 50% automatic on a $150 bag', () => {
      const half = automatic({ value: 50, combinable: true, priority: 5 })
      const code = discount({ value: 10, combinable: true, minimum: 100 })
      const r = run(input({ code, automatic: [half], lines: [line({ lineId: 'x', unit: 150 })] }))
      assert.equal(r.rejected, null)
      money(find(r, half.id).amount, 75)
      money(find(r, code.id).amount, 7.5)
      money(r.discountTotal, 82.5)
    })

    it('an automatic with a minimum still applies after an earlier combinable automatic', () => {
      const first = automatic({ value: 50, combinable: true, priority: 10 })
      const later = automatic({ kind: 'fixed', value: 10, combinable: true, priority: 1, minimum: 120 })
      const r = run(input({ automatic: [first, later], lines: [line({ unit: 150 })] }))
      assert.deepEqual(appliedIds(r), [first.id, later.id])
      money(r.discountTotal, 85)
    })

    it('minimumQty counts original units even after a bxgy made one free', () => {
      const b2g1 = automatic({ kind: 'bxgy', value: 0, buyQty: 2, getQty: 1, getPercent: 100, combinable: true, priority: 10 })
      const code = discount({ value: 10, combinable: true, minimumQty: 3 })
      const r = run(input({ code, automatic: [b2g1], lines: [line({ unit: 30, qty: 3 })] }))
      assert.equal(r.rejected, null)
      money(find(r, b2g1.id).amount, 30)
      money(find(r, code.id).amount, 6)
    })
  })
})
