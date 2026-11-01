/* Engine rule 1: validity checks, each with its own error code, in the listed order. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { NOW, automatic, daysFromNow, discount, expectRejected, input, line, money, run, find } from './promotions-helpers'

describe('validity', () => {
  it('no code entered: nothing rejected, nothing applied', () => {
    const r = run(input())
    assert.equal(r.rejected, null)
    assert.deepEqual(r.applied, [])
    money(r.discountTotal, 0)
    assert.equal(r.freeShipping, false)
  })

  it('unknown code (codeEntered set, code null) -> DISCOUNT_INVALID', () => {
    const r = run(input({ code: null, codeEntered: 'NOPE' }))
    expectRejected(r, 'DISCOUNT_INVALID')
    assert.deepEqual(r.applied, [])
    money(r.discountTotal, 0)
  })

  it('unknown code does not block valid automatics', () => {
    const a = automatic({ value: 10 })
    const r = run(input({ code: null, codeEntered: 'NOPE', automatic: [a], lines: [line({ unit: 100 })] }))
    expectRejected(r, 'DISCOUNT_INVALID')
    money(find(r, a.id).amount, 10)
  })

  it('valid code applies with its code and method', () => {
    const d = discount({ code: 'SAVE10', value: 10 })
    const r = run(input({ code: d, codeEntered: 'SAVE10', lines: [line({ unit: 80 })] }))
    assert.equal(r.rejected, null)
    const a = find(r, d.id)
    assert.equal(a.method, 'code')
    assert.equal(a.code, 'SAVE10')
    assert.equal(a.label, d.label)
    assert.equal(a.freeShipping, false)
    money(a.amount, 8)
    money(r.discountTotal, 8)
  })

  it('inactive -> DISCOUNT_INACTIVE', () => {
    const d = discount({ active: false })
    const r = run(input({ code: d }))
    expectRejected(r, 'DISCOUNT_INACTIVE')
    assert.deepEqual(r.applied, [])
  })

  it('start date in the future -> DISCOUNT_NOT_STARTED', () => {
    const d = discount({ startsAt: daysFromNow(1) })
    expectRejected(run(input({ code: d })), 'DISCOUNT_NOT_STARTED')
  })

  it('startsAt == now has started', () => {
    const d = discount({ startsAt: new Date(NOW) })
    assert.equal(run(input({ code: d })).rejected, null)
  })

  it('end date passed -> DISCOUNT_EXPIRED', () => {
    const d = discount({ endsAt: daysFromNow(-1) })
    expectRejected(run(input({ code: d })), 'DISCOUNT_EXPIRED')
  })

  it('endsAt == now counts as expired', () => {
    const d = discount({ endsAt: new Date(NOW) })
    expectRejected(run(input({ code: d })), 'DISCOUNT_EXPIRED')
  })

  it('endsAt in the future is valid', () => {
    const d = discount({ endsAt: new Date(NOW.getTime() + 1000) })
    assert.equal(run(input({ code: d })).rejected, null)
  })

  it('usage limit reached -> DISCOUNT_USED_UP', () => {
    const d = discount({ usageLimit: 5, used: 5 })
    expectRejected(run(input({ code: d })), 'DISCOUNT_USED_UP')
  })

  it('usage limit not yet reached applies', () => {
    const d = discount({ usageLimit: 5, used: 4 })
    assert.equal(run(input({ code: d })).rejected, null)
  })

  it('unique code already used -> DISCOUNT_USED_UP', () => {
    const d = discount({ code: null, codeType: 'unique', uniqueCodeUsed: true })
    expectRejected(run(input({ code: d, codeEntered: 'WELCOME-ABCD2345' })), 'DISCOUNT_USED_UP')
  })

  it('unique code not yet used applies, reporting the entered code', () => {
    const d = discount({ code: null, codeType: 'unique', uniqueCodeUsed: false, value: 15 })
    const r = run(input({ code: d, codeEntered: 'WELCOME-ABCD2345', lines: [line({ unit: 100 })] }))
    assert.equal(r.rejected, null)
    const a = find(r, d.id)
    assert.equal(a.code, 'WELCOME-ABCD2345')
    money(a.amount, 15)
  })

  describe('precedence when several checks fail', () => {
    it('inactive beats not started', () => {
      const d = discount({ active: false, startsAt: daysFromNow(2) })
      expectRejected(run(input({ code: d })), 'DISCOUNT_INACTIVE')
    })
    it('inactive beats expired', () => {
      const d = discount({ active: false, endsAt: daysFromNow(-2) })
      expectRejected(run(input({ code: d })), 'DISCOUNT_INACTIVE')
    })
    it('not started beats used up', () => {
      const d = discount({ startsAt: daysFromNow(2), usageLimit: 1, used: 1 })
      expectRejected(run(input({ code: d })), 'DISCOUNT_NOT_STARTED')
    })
    it('expired beats used up', () => {
      const d = discount({ endsAt: daysFromNow(-2), usageLimit: 1, used: 3, uniqueCodeUsed: true })
      expectRejected(run(input({ code: d })), 'DISCOUNT_EXPIRED')
    })
    it('used up beats not eligible', () => {
      const d = discount({ usageLimit: 1, used: 1, eligibility: 'subscribers' })
      expectRejected(run(input({ code: d })), 'DISCOUNT_USED_UP')
    })
    it('not eligible beats customer limit', () => {
      const d = discount({ eligibility: 'subscribers', perCustomerLimit: 1 })
      const inp = input({ code: d })
      inp.customer.redemptions = { [d.id]: 1 }
      expectRejected(run(inp), 'DISCOUNT_NOT_ELIGIBLE')
    })
    it('customer limit beats not applicable', () => {
      const d = discount({ perCustomerLimit: 1, scope: 'products', productIds: ['other'] })
      const inp = input({ code: d })
      inp.customer.redemptions = { [d.id]: 1 }
      expectRejected(run(inp), 'DISCOUNT_CUSTOMER_LIMIT')
    })
    it('not applicable beats minimum', () => {
      const d = discount({ scope: 'products', productIds: ['other'], minimum: 100, minimumQty: 3 })
      expectRejected(run(input({ code: d })), 'DISCOUNT_NOT_APPLICABLE')
    })
    it('min qty beats minimum spend', () => {
      const d = discount({ minimum: 1000, minimumQty: 3 })
      expectRejected(run(input({ code: d, lines: [line({ qty: 1, unit: 10 })] })), 'DISCOUNT_MIN_QTY')
    })
    it('everything wrong at once reports INACTIVE', () => {
      const d = discount({
        active: false,
        endsAt: daysFromNow(-1),
        usageLimit: 1,
        used: 1,
        eligibility: 'subscribers',
        minimum: 999,
      })
      expectRejected(run(input({ code: d })), 'DISCOUNT_INACTIVE')
    })
  })

  describe('automatic discounts are validated too (silently)', () => {
    it('inactive, not started, expired and used-up automatics never apply and never set rejected', () => {
      const autos = [
        automatic({ active: false }),
        automatic({ startsAt: daysFromNow(1) }),
        automatic({ endsAt: daysFromNow(-1) }),
        automatic({ usageLimit: 2, used: 2 }),
      ]
      const r = run(input({ automatic: autos, lines: [line({ unit: 100 })] }))
      assert.deepEqual(r.applied, [])
      assert.equal(r.rejected, null)
      money(r.discountTotal, 0)
    })
    it('automatic below minimum does not apply and does not set rejected', () => {
      const a = automatic({ minimum: 500 })
      const r = run(input({ automatic: [a], lines: [line({ unit: 100 })] }))
      assert.deepEqual(r.applied, [])
      assert.equal(r.rejected, null)
    })
    it('applied automatic has method automatic and null code', () => {
      const a = automatic({ value: 20 })
      const r = run(input({ automatic: [a], lines: [line({ unit: 100 })] }))
      const ap = find(r, a.id)
      assert.equal(ap.method, 'automatic')
      assert.equal(ap.code, null)
      money(ap.amount, 20)
    })
  })
})
