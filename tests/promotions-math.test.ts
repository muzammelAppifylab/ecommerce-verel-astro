/* Engine rule 4: amounts, allocation, rounding, buy X get Y. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { alloc, automatic, discount, expectRejected, find, input, line, money, run } from './promotions-helpers'

const bxgy = (over = {}) =>
  discount({ kind: 'bxgy', value: 0, buyQty: 2, getQty: 1, getPercent: 100, ...over })

describe('percent', () => {
  it('takes the percent of the in-scope amount', () => {
    const d = discount({ value: 15 })
    const r = run(input({ code: d, lines: [line({ unit: 30, qty: 3 })] }))
    money(find(r, d.id).amount, 13.5)
  })
  it('is capped by maxAmount', () => {
    const d = discount({ value: 20, maxAmount: 50 })
    const r = run(input({ code: d, lines: [line({ unit: 150, qty: 2 })] }))
    money(find(r, d.id).amount, 50)
    money(r.discountTotal, 50)
  })
  it('below the cap is not affected by maxAmount', () => {
    const d = discount({ value: 20, maxAmount: 50 })
    const r = run(input({ code: d, lines: [line({ unit: 100 })] }))
    money(find(r, d.id).amount, 20)
  })
  it('capped amount is split across lines with an exact sum', () => {
    const d = discount({ value: 50, maxAmount: 10 })
    const ls = [line({ lineId: 'a', unit: 20 }), line({ lineId: 'b', unit: 20 }), line({ lineId: 'c', unit: 20 })]
    const r = run(input({ code: d, lines: ls }))
    money(find(r, d.id).amount, 10)
    money(alloc(r, d.id, 'a'), 3.33)
    money(alloc(r, d.id, 'b'), 3.33)
    money(alloc(r, d.id, 'c'), 3.34)
  })
  it('rounds to cents', () => {
    const d = discount({ value: 15 })
    const r = run(input({ code: d, lines: [line({ unit: 19.99 })] }))
    money(find(r, d.id).amount, 3) // 2.9985
  })
  it('100% off gives the whole in-scope amount and never more', () => {
    const d = discount({ value: 100 })
    const r = run(input({ code: d, lines: [line({ unit: 42.5, qty: 2 })] }))
    money(find(r, d.id).amount, 85)
  })
})

describe('fixed', () => {
  it('takes the value when the in-scope amount is larger', () => {
    const d = discount({ kind: 'fixed', value: 25 })
    const r = run(input({ code: d, lines: [line({ unit: 100 })] }))
    money(find(r, d.id).amount, 25)
  })
  it('is capped at the in-scope amount', () => {
    const d = discount({ kind: 'fixed', value: 50, scope: 'products', productIds: ['p-cheap'] })
    const ls = [line({ lineId: 'cheap', productId: 'p-cheap', unit: 30 }), line({ lineId: 'big', productId: 'p-big', unit: 200 })]
    const r = run(input({ code: d, lines: ls }))
    money(find(r, d.id).amount, 30)
    money(alloc(r, d.id, 'cheap'), 30)
    money(r.lineDiscounts.big ?? 0, 0)
  })
  it('$10 across 3 equal lines -> 3.33 / 3.33 / 3.34', () => {
    const d = discount({ kind: 'fixed', value: 10 })
    const ls = [line({ lineId: 'a', unit: 25 }), line({ lineId: 'b', unit: 25 }), line({ lineId: 'c', unit: 25 })]
    const r = run(input({ code: d, lines: ls }))
    const a = find(r, d.id)
    money(a.amount, 10)
    money(alloc(r, d.id, 'a'), 3.33)
    money(alloc(r, d.id, 'b'), 3.33)
    money(alloc(r, d.id, 'c'), 3.34)
  })
  it('is split in proportion to line amounts (qty counts)', () => {
    const d = discount({ kind: 'fixed', value: 20 })
    const ls = [line({ lineId: 'a', unit: 30, qty: 2 }), line({ lineId: 'b', unit: 20, qty: 1 })] // 60 : 20
    const r = run(input({ code: d, lines: ls }))
    money(alloc(r, d.id, 'a'), 15)
    money(alloc(r, d.id, 'b'), 5)
  })
})

describe('shipping', () => {
  it('sets freeShipping with amount 0', () => {
    const d = discount({ kind: 'shipping', value: 0, code: 'FREESHIP' })
    const r = run(input({ code: d, codeEntered: 'FREESHIP', lines: [line({ unit: 60 })], shippingRate: 8 }))
    const a = find(r, d.id)
    assert.equal(a.freeShipping, true)
    money(a.amount, 0)
    assert.equal(r.freeShipping, true)
    money(r.discountTotal, 0)
    assert.equal(a.allocations.reduce((s, x) => s + x.amount, 0), 0)
  })
  it('applies even when no shipping method is selected (rate 0)', () => {
    const d = discount({ kind: 'shipping', value: 0 })
    const r = run(input({ code: d, lines: [line()], shippingRate: 0 }))
    assert.equal(r.rejected, null)
    assert.equal(r.freeShipping, true)
  })
})

describe('buy X get Y', () => {
  it('buy 2 get 1 free with 3 units: cheapest free', () => {
    const d = bxgy()
    const r = run(input({ code: d, lines: [line({ unit: 68, qty: 3 })] }))
    money(find(r, d.id).amount, 68)
  })
  it('5 units: only one full group', () => {
    const d = bxgy()
    const r = run(input({ code: d, lines: [line({ unit: 68, qty: 5 })] }))
    money(find(r, d.id).amount, 68)
  })
  it('6 units: two free', () => {
    const d = bxgy()
    const r = run(input({ code: d, lines: [line({ unit: 68, qty: 6 })] }))
    money(find(r, d.id).amount, 136)
  })
  it('mixed prices across lines: within each sorted group the cheapest unit is free', () => {
    const d = bxgy()
    const ls = [
      line({ lineId: 'a', unit: 60 }),
      line({ lineId: 'b', unit: 50 }),
      line({ lineId: 'c', unit: 40 }),
      line({ lineId: 'd', unit: 30 }),
      line({ lineId: 'e', unit: 20 }),
      line({ lineId: 'f', unit: 10 }),
    ]
    // sorted 60,50,40 | 30,20,10 -> 40 + 10 free
    const r = run(input({ code: d, lines: ls }))
    money(find(r, d.id).amount, 50)
    money(alloc(r, d.id, 'c'), 40)
    money(alloc(r, d.id, 'f'), 10)
    for (const id of ['a', 'b', 'd', 'e']) money(alloc(r, d.id, id), 0, `line ${id}`)
  })
  it('mixed prices with a leftover unit: leftover (cheapest) stays full price', () => {
    const d = bxgy()
    const ls = [line({ lineId: 'a', unit: 50, qty: 2 }), line({ lineId: 'b', unit: 30 }), line({ lineId: 'c', unit: 20 })]
    // sorted 50,50,30 | 20 -> 30 free
    const r = run(input({ code: d, lines: ls }))
    money(find(r, d.id).amount, 30)
    money(alloc(r, d.id, 'b'), 30)
    money(alloc(r, d.id, 'c'), 0)
  })
  it('getPercent 50', () => {
    const d = bxgy({ getPercent: 50 })
    const r = run(input({ code: d, lines: [line({ unit: 40, qty: 3 })] }))
    money(find(r, d.id).amount, 20)
  })
  it('buy 1 get 2 at 100%', () => {
    const d = bxgy({ buyQty: 1, getQty: 2 })
    const ls = [line({ lineId: 'a', unit: 90 }), line({ lineId: 'b', unit: 30, qty: 2 })]
    const r = run(input({ code: d, lines: ls }))
    money(find(r, d.id).amount, 60)
    money(alloc(r, d.id, 'b'), 60)
  })
  it('only in-scope units count toward groups', () => {
    const d = bxgy({ scope: 'categories', categoryIds: ['tees'] })
    const ls = [
      line({ lineId: 't', categoryId: 'tees', unit: 68, qty: 2 }),
      line({ lineId: 'j', categoryId: 'jeans', unit: 10, qty: 1 }),
    ]
    const r = run(input({ code: d, lines: ls }))
    expectRejected(r, 'DISCOUNT_MIN_QTY')
    assert.deepEqual(r.applied, [])
  })
  it('qty below buy+get -> DISCOUNT_MIN_QTY (too few in-scope units)', () => {
    const d = bxgy()
    const r = run(input({ code: d, lines: [line({ unit: 68, qty: 2 })] }))
    expectRejected(r, 'DISCOUNT_MIN_QTY')
    assert.deepEqual(r.applied, [])
    money(r.discountTotal, 0)
  })
})

describe('invariants across stacking', () => {
  it('lineDiscounts equals sum of allocations and discountTotal equals sum of amounts', () => {
    const a1 = automatic({ value: 10, combinable: true, priority: 5 })
    const a2 = automatic({ kind: 'fixed', value: 7, combinable: true, priority: 1 })
    const ls = [line({ lineId: 'a', unit: 33.33 }), line({ lineId: 'b', unit: 66.67, qty: 2 })]
    const r = run(input({ automatic: [a1, a2], lines: ls }))
    assert.equal(r.applied.length, 2)
    const total = r.applied.reduce((s, a) => s + Math.round(a.amount * 100), 0)
    assert.equal(Math.round(r.discountTotal * 100), total)
    const la = r.applied.reduce((s, a) => s + Math.round((a.allocations.find((x) => x.lineId === 'a')?.amount ?? 0) * 100), 0)
    assert.equal(Math.round(r.lineDiscounts.a * 100), la)
  })
  it('no line below zero when stacking two fixed discounts', () => {
    const a1 = automatic({ kind: 'fixed', value: 50, combinable: true, priority: 2 })
    const a2 = automatic({ kind: 'fixed', value: 50, combinable: true, priority: 1 })
    const r = run(input({ automatic: [a1, a2], lines: [line({ lineId: 'x', unit: 60 })] }))
    money(find(r, a1.id).amount, 50)
    money(find(r, a2.id).amount, 10)
    money(r.lineDiscounts.x, 60)
    money(r.discountTotal, 60)
  })
  it('a fully discounted bag gives later combinable discounts nothing to take', () => {
    const a1 = automatic({ value: 100, combinable: true, priority: 2 })
    const a2 = automatic({ value: 10, combinable: true, priority: 1 })
    const r = run(input({ automatic: [a1, a2], lines: [line({ lineId: 'x', unit: 60 })] }))
    money(r.discountTotal, 60)
    money(r.lineDiscounts.x, 60)
  })
})
