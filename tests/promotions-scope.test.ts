/* Scope (which bag lines count), minimum spend and minimum quantity on in-scope lines. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { alloc, automatic, discount, expectRejected, find, input, line, money, run } from './promotions-helpers'

const lines = [
  line({ lineId: 'knit', productId: 'p-knit', categoryId: 'c-knit', departmentId: 'd-women', unit: 100, qty: 1 }),
  line({ lineId: 'tee', productId: 'p-tee', categoryId: 'c-tee', departmentId: 'd-men', unit: 40, qty: 2 }),
  line({ lineId: 'gift', productId: 'p-gift', categoryId: 'c-gift', departmentId: 'd-women', unit: 20, qty: 1, digital: true }),
]

describe('scope', () => {
  it('order scope covers every line', () => {
    const d = discount({ value: 10 })
    const r = run(input({ code: d, lines }))
    const a = find(r, d.id)
    money(a.amount, 20) // 10% of 200
    money(alloc(r, d.id, 'knit'), 10)
    money(alloc(r, d.id, 'tee'), 8)
    money(alloc(r, d.id, 'gift'), 2)
  })

  it('products scope only discounts matching products', () => {
    const d = discount({ value: 10, scope: 'products', productIds: ['p-tee'] })
    const r = run(input({ code: d, lines }))
    money(find(r, d.id).amount, 8)
    money(alloc(r, d.id, 'tee'), 8)
    money(r.lineDiscounts.knit ?? 0, 0)
    money(r.lineDiscounts.gift ?? 0, 0)
  })

  it('categories scope only discounts matching categories', () => {
    const d = discount({ value: 50, scope: 'categories', categoryIds: ['c-knit', 'c-none'] })
    const r = run(input({ code: d, lines }))
    money(find(r, d.id).amount, 50)
    money(alloc(r, d.id, 'knit'), 50)
    money(r.lineDiscounts.tee ?? 0, 0)
  })

  it('departments scope only discounts matching departments', () => {
    const d = discount({ value: 10, scope: 'departments', departmentIds: ['d-women'] })
    const r = run(input({ code: d, lines }))
    money(find(r, d.id).amount, 12) // knit 100 + gift 20
    money(alloc(r, d.id, 'knit'), 10)
    money(alloc(r, d.id, 'gift'), 2)
    money(r.lineDiscounts.tee ?? 0, 0)
  })

  it('no lines in scope -> DISCOUNT_NOT_APPLICABLE', () => {
    const d = discount({ scope: 'categories', categoryIds: ['c-shoes'] })
    const r = run(input({ code: d, lines }))
    expectRejected(r, 'DISCOUNT_NOT_APPLICABLE')
    assert.deepEqual(r.applied, [])
  })

  it('empty bag with a code -> DISCOUNT_NOT_APPLICABLE', () => {
    const d = discount()
    expectRejected(run(input({ code: d, lines: [] })), 'DISCOUNT_NOT_APPLICABLE')
  })

  it('minimum spend counts only in-scope lines (fails)', () => {
    // in scope: tees 80; whole bag 200
    const d = discount({ scope: 'categories', categoryIds: ['c-tee'], minimum: 100 })
    expectRejected(run(input({ code: d, lines })), 'DISCOUNT_MINIMUM')
  })

  it('minimum spend counts only in-scope lines (passes when in-scope meets it)', () => {
    const d = discount({ scope: 'categories', categoryIds: ['c-tee'], minimum: 80, value: 10 })
    const r = run(input({ code: d, lines }))
    assert.equal(r.rejected, null)
    money(find(r, d.id).amount, 8)
  })

  it('minimum spend exactly met passes', () => {
    const d = discount({ minimum: 200 })
    assert.equal(run(input({ code: d, lines })).rejected, null)
  })

  it('minimumQty counts in-scope units (fails)', () => {
    // in scope: women dept = knit 1 + gift 1 = 2 units; bag has 4 units
    const d = discount({ scope: 'departments', departmentIds: ['d-women'], minimumQty: 3 })
    expectRejected(run(input({ code: d, lines })), 'DISCOUNT_MIN_QTY')
  })

  it('minimumQty counts quantity, not lines (passes)', () => {
    const d = discount({ scope: 'categories', categoryIds: ['c-tee'], minimumQty: 2 })
    assert.equal(run(input({ code: d, lines })).rejected, null)
  })

  it('digital lines in scope are discounted like any other line', () => {
    const d = discount({ value: 25, scope: 'products', productIds: ['p-gift'] })
    const r = run(input({ code: d, lines }))
    money(find(r, d.id).amount, 5)
    money(alloc(r, d.id, 'gift'), 5)
  })

  it('shipping discount scope decides whether it applies (in scope)', () => {
    const d = automatic({ kind: 'shipping', value: 0, scope: 'categories', categoryIds: ['c-knit'] })
    const r = run(input({ automatic: [d], lines, shippingRate: 8 }))
    assert.equal(r.freeShipping, true)
    assert.equal(find(r, d.id).freeShipping, true)
  })

  it('shipping discount scope decides whether it applies (out of scope)', () => {
    const d = discount({ kind: 'shipping', value: 0, scope: 'categories', categoryIds: ['c-shoes'] })
    const r = run(input({ code: d, lines, shippingRate: 8 }))
    expectRejected(r, 'DISCOUNT_NOT_APPLICABLE')
    assert.equal(r.freeShipping, false)
  })
})
