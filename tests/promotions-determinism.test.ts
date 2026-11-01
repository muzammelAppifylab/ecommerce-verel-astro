/* The engine is pure: same input, same output; inputs are never mutated. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { evaluatePromotions } from '../src/server/lib/discounts'
import { automatic, discount, input, line } from './promotions-helpers'

const build = () =>
  input({
    code: discount({ id: 'ten', kind: 'fixed', value: 10, combinable: true, code: 'TEN' }),
    codeEntered: 'TEN',
    automatic: [
      automatic({ id: 'knit15', value: 15, combinable: true, priority: 5, scope: 'categories', categoryIds: ['knit'] }),
      automatic({ id: 'b2g1', kind: 'bxgy', value: 0, buyQty: 2, getQty: 1, getPercent: 100, combinable: true, priority: 1 }),
      automatic({ id: 'off50', value: 50, active: false }),
    ],
    lines: [
      line({ lineId: 'a', categoryId: 'knit', unit: 120, qty: 1 }),
      line({ lineId: 'b', categoryId: 'tee', unit: 33.33, qty: 3 }),
      line({ lineId: 'c', categoryId: 'tee', unit: 19.99, qty: 2 }),
    ],
    shippingRate: 8,
  })

describe('determinism', () => {
  it('same input gives an identical output', () => {
    const inp = build()
    const r1 = evaluatePromotions(inp)
    const r2 = evaluatePromotions(inp)
    const r3 = evaluatePromotions(build())
    assert.deepEqual(r1, r2)
    assert.deepEqual(r1, r3)
  })

  it('input arrays and objects are not mutated', () => {
    const inp = build()
    const snapshot = structuredClone(inp)
    const linesRef = inp.lines
    const autoRef = inp.automatic
    evaluatePromotions(inp)
    assert.deepEqual(inp, snapshot)
    assert.equal(inp.lines, linesRef)
    assert.equal(inp.automatic, autoRef)
    assert.deepEqual(inp.automatic.map((a) => a.id), snapshot.automatic.map((a) => a.id))
  })

  it('order of the automatic array does not change the result', () => {
    const inp = build()
    const reversed = { ...build(), automatic: [...build().automatic].reverse() }
    assert.deepEqual(evaluatePromotions(reversed), evaluatePromotions(inp))
  })
})
