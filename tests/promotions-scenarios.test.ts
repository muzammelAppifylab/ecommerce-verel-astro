/* Realistic VAREL scenarios built from the seeded examples in docs/PROMOTIONS.md. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { alloc, appliedIds, automatic, customer, daysFromNow, discount, expectRejected, find, guest, input, line, money, run } from './promotions-helpers'

const STUDIO10 = () => discount({ id: 'studio10', code: 'STUDIO10', kind: 'percent', value: 10, minimum: 100, label: '10% off' })
const FREESHIP = () => discount({ id: 'freeship', code: 'FREESHIP', kind: 'shipping', value: 0, label: 'Free shipping' })
const FIRST25 = () =>
  discount({ id: 'first25', code: 'FIRST25', kind: 'fixed', value: 25, minimum: 200, eligibility: 'first_order', perCustomerLimit: 1 })
const AUTUMN = () =>
  automatic({
    id: 'autumn',
    name: 'Autumn knitwear',
    label: '15% off knitwear',
    kind: 'percent',
    value: 15,
    scope: 'categories',
    categoryIds: ['knit-women', 'knit-men'],
    priority: 10,
    combinable: false,
    startsAt: daysFromNow(-1),
    endsAt: daysFromNow(30),
  })
const TEES3 = () =>
  discount({
    id: 'tees3',
    code: 'TEES3',
    kind: 'bxgy',
    value: 0,
    buyQty: 2,
    getQty: 1,
    getPercent: 100,
    scope: 'categories',
    categoryIds: ['tees-women', 'tees-men'],
    combinable: true,
  })
const WELCOME = (over = {}) =>
  discount({ id: 'welcome', code: null, codeType: 'unique', kind: 'percent', value: 15, maxAmount: 40, perCustomerLimit: 1, ...over })

const knitW = (unit: number, qty = 1) => line({ lineId: 'knit-w', productId: 'cardigan', categoryId: 'knit-women', departmentId: 'women', unit, qty })
const knitM = (unit: number, qty = 1) => line({ lineId: 'knit-m', productId: 'crew', categoryId: 'knit-men', departmentId: 'men', unit, qty })
const heavyTee = (qty: number) => line({ lineId: 'tee', productId: 'core-heavy-tee', categoryId: 'tees-men', departmentId: 'men', unit: 68, qty })
const jeans = (unit: number) => line({ lineId: 'jeans', productId: 'straight-jean', categoryId: 'denim', departmentId: 'women', unit })

describe('VAREL scenarios', () => {
  it('Autumn knitwear applies by itself across both departments', () => {
    const r = run(input({ automatic: [AUTUMN()], lines: [knitW(120), knitM(80), heavyTee(1)] }))
    const a = find(r, 'autumn')
    assert.equal(a.method, 'automatic')
    assert.equal(a.label, '15% off knitwear')
    money(a.amount, 30)
    money(alloc(r, 'autumn', 'knit-w'), 18)
    money(alloc(r, 'autumn', 'knit-m'), 12)
    money(r.lineDiscounts.tee ?? 0, 0)
  })

  it('STUDIO10 loses to Autumn knitwear on a knit-heavy bag', () => {
    // Autumn: 15% of 180 = 27; STUDIO10: 10% of 248 = 24.80
    const r = run(input({ code: STUDIO10(), automatic: [AUTUMN()], lines: [knitW(180), heavyTee(1)] }))
    assert.deepEqual(appliedIds(r), ['autumn'])
    money(r.discountTotal, 27)
    expectRejected(r, 'DISCOUNT_NOT_COMBINABLE')
  })

  it('STUDIO10 beats Autumn knitwear on a denim-heavy bag', () => {
    // Autumn: 15% of 60 = 9; STUDIO10: 10% of 260 = 26
    const r = run(input({ code: STUDIO10(), automatic: [AUTUMN()], lines: [knitW(60), jeans(200)] }))
    assert.deepEqual(appliedIds(r), ['studio10'])
    money(r.discountTotal, 26)
    money(alloc(r, 'studio10', 'knit-w'), 6)
    money(alloc(r, 'studio10', 'jeans'), 20)
    assert.equal(r.rejected, null)
  })

  it('STUDIO10 under $100 -> DISCOUNT_MINIMUM', () => {
    const r = run(input({ code: STUDIO10(), lines: [heavyTee(1)] }))
    expectRejected(r, 'DISCOUNT_MINIMUM')
    assert.deepEqual(r.applied, [])
  })

  it('TEES3: three Core Heavy Tees at $68, one free', () => {
    const r = run(input({ code: TEES3(), lines: [heavyTee(3)] }))
    money(find(r, 'tees3').amount, 68)
    money(alloc(r, 'tees3', 'tee'), 68)
    money(r.discountTotal, 68)
  })

  it('TEES3 beats non-combinable Autumn knitwear (68 vs 15)', () => {
    const r = run(input({ code: TEES3(), automatic: [AUTUMN()], lines: [heavyTee(3), knitM(100)] }))
    assert.deepEqual(appliedIds(r), ['tees3'])
    money(r.discountTotal, 68)
    assert.equal(r.rejected, null)
  })

  it('TEES3 with only two tees: code waits for a third, Autumn still applies', () => {
    const r = run(input({ code: TEES3(), automatic: [AUTUMN()], lines: [heavyTee(2), knitM(100)] }))
    expectRejected(r, 'DISCOUNT_MIN_QTY')
    assert.deepEqual(appliedIds(r), ['autumn'])
    money(r.discountTotal, 15)
  })

  it('FREESHIP on a small bag gives free shipping', () => {
    const r = run(input({ code: FREESHIP(), lines: [heavyTee(1)], shippingRate: 8 }))
    assert.equal(r.freeShipping, true)
    money(r.discountTotal, 0)
  })

  it('WELCOME: 15% off a $100 bag', () => {
    const r = run(input({ code: WELCOME(), codeEntered: 'WELCOME-K7M3PQ2X', lines: [jeans(100)] }))
    const a = find(r, 'welcome')
    money(a.amount, 15)
    assert.equal(a.code, 'WELCOME-K7M3PQ2X')
  })

  it('WELCOME: capped at $40 on a $400 bag', () => {
    const r = run(input({ code: WELCOME(), codeEntered: 'WELCOME-K7M3PQ2X', lines: [jeans(400)] }))
    money(find(r, 'welcome').amount, 40)
  })

  it('WELCOME: a used unique code -> DISCOUNT_USED_UP', () => {
    const r = run(input({ code: WELCOME({ uniqueCodeUsed: true }), codeEntered: 'WELCOME-K7M3PQ2X', lines: [jeans(100)] }))
    expectRejected(r, 'DISCOUNT_USED_UP')
  })

  it('WELCOME: a second WELCOME code for the same customer -> DISCOUNT_CUSTOMER_LIMIT', () => {
    const c = customer({ redemptions: { welcome: 1 } })
    const r = run(input({ code: WELCOME(), codeEntered: 'WELCOME-ZZZZ2222', lines: [jeans(100)], customer: c }))
    expectRejected(r, 'DISCOUNT_CUSTOMER_LIMIT')
  })

  it('FIRST25: $25 off a $250 first order, split by line', () => {
    const r = run(input({ code: FIRST25(), lines: [knitW(150), jeans(100)] }))
    money(find(r, 'first25').amount, 25)
    money(alloc(r, 'first25', 'knit-w'), 15)
    money(alloc(r, 'first25', 'jeans'), 10)
  })

  it('FIRST25: returning customer -> DISCOUNT_NOT_ELIGIBLE', () => {
    const r = run(input({ code: FIRST25(), lines: [jeans(250)], customer: customer({ paidOrders: 2 }) }))
    expectRejected(r, 'DISCOUNT_NOT_ELIGIBLE')
  })

  it('FIRST25: under $200 -> DISCOUNT_MINIMUM', () => {
    expectRejected(run(input({ code: FIRST25(), lines: [jeans(150)] })), 'DISCOUNT_MINIMUM')
  })

  it('FIRST25: guest passes at cart, then fails at checkout when the email has a paid order', () => {
    const cart = run(input({ code: FIRST25(), lines: [jeans(250)], customer: guest() }))
    assert.equal(cart.rejected, null)
    money(cart.discountTotal, 25)
    const checkout = run(
      input({ code: FIRST25(), lines: [jeans(250)], customer: guest({ email: 'returning@example.com', paidOrders: 1 }), stage: 'checkout' }),
    )
    expectRejected(checkout, 'DISCOUNT_NOT_ELIGIBLE')
    money(checkout.discountTotal, 0)
  })
})
