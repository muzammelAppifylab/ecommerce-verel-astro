/* Engine rules 1-3: eligibility, per-customer limits, and cart (provisional) vs checkout (final) stages. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { automatic, customer, discount, expectRejected, find, guest, input, line, money, run } from './promotions-helpers'

const bag = [line({ unit: 100 })]

describe('eligibility', () => {
  describe('signed_in', () => {
    it('signed-in customer passes at cart', () => {
      const d = discount({ eligibility: 'signed_in' })
      const r = run(input({ code: d, lines: bag }))
      assert.equal(r.rejected, null)
      money(find(r, d.id).amount, 10)
    })
    it('signed-in customer passes at checkout', () => {
      const d = discount({ eligibility: 'signed_in' })
      assert.equal(run(input({ code: d, lines: bag, stage: 'checkout' })).rejected, null)
    })
    it('guest at checkout (with checkout email) -> DISCOUNT_NOT_ELIGIBLE', () => {
      const d = discount({ eligibility: 'signed_in' })
      const r = run(input({ code: d, lines: bag, stage: 'checkout', customer: guest({ email: 'g@example.com' }) }))
      expectRejected(r, 'DISCOUNT_NOT_ELIGIBLE')
      assert.deepEqual(r.applied, [])
    })
    // Spec rule 2 lists signed_in among the checks where "a guest without an email passes provisionally" at cart.
    it('guest without email at cart passes provisionally (rule 2)', () => {
      const d = discount({ eligibility: 'signed_in' })
      const r = run(input({ code: d, lines: bag, customer: guest() }))
      assert.equal(r.rejected, null)
      money(find(r, d.id).amount, 10)
    })
  })

  describe('first_order', () => {
    it('paidOrders 0 is eligible', () => {
      const d = discount({ eligibility: 'first_order' })
      assert.equal(run(input({ code: d, lines: bag, customer: customer({ paidOrders: 0 }) })).rejected, null)
    })
    it('signed in with paidOrders > 0 fails at cart', () => {
      const d = discount({ eligibility: 'first_order' })
      expectRejected(run(input({ code: d, lines: bag, customer: customer({ paidOrders: 1 }) })), 'DISCOUNT_NOT_ELIGIBLE')
    })
    it('guest at cart with no email passes provisionally', () => {
      const d = discount({ eligibility: 'first_order' })
      const r = run(input({ code: d, lines: bag, customer: guest() }))
      assert.equal(r.rejected, null)
      money(find(r, d.id).amount, 10)
    })
    it('guest at checkout with email and paidOrders > 0 fails', () => {
      const d = discount({ eligibility: 'first_order' })
      const c = guest({ email: 'g@example.com', paidOrders: 2 })
      const r = run(input({ code: d, lines: bag, customer: c, stage: 'checkout' }))
      expectRejected(r, 'DISCOUNT_NOT_ELIGIBLE')
      assert.deepEqual(r.applied, [])
      money(r.discountTotal, 0)
    })
    it('guest at checkout with email and paidOrders 0 passes', () => {
      const d = discount({ eligibility: 'first_order' })
      const c = guest({ email: 'g@example.com', paidOrders: 0 })
      assert.equal(run(input({ code: d, lines: bag, customer: c, stage: 'checkout' })).rejected, null)
    })
    it('first_order automatic does not apply for a returning customer', () => {
      const a = automatic({ eligibility: 'first_order' })
      const r = run(input({ automatic: [a], lines: bag, customer: customer({ paidOrders: 3 }) }))
      assert.deepEqual(r.applied, [])
      assert.equal(r.rejected, null)
    })
  })

  describe('subscribers', () => {
    it('subscriber passes', () => {
      const d = discount({ eligibility: 'subscribers' })
      assert.equal(run(input({ code: d, lines: bag, customer: customer({ subscriber: true }) })).rejected, null)
    })
    it('non-subscriber signed in fails', () => {
      const d = discount({ eligibility: 'subscribers' })
      expectRejected(run(input({ code: d, lines: bag, customer: customer({ subscriber: false }) })), 'DISCOUNT_NOT_ELIGIBLE')
    })
    it('guest without email at cart passes provisionally; fails at checkout when not subscribed', () => {
      const d = discount({ eligibility: 'subscribers' })
      assert.equal(run(input({ code: d, lines: bag, customer: guest() })).rejected, null)
      const c = guest({ email: 'g@example.com', subscriber: false })
      expectRejected(run(input({ code: d, lines: bag, customer: c, stage: 'checkout' })), 'DISCOUNT_NOT_ELIGIBLE')
    })
  })

  describe('customers list', () => {
    it('customer id in list passes', () => {
      const d = discount({ eligibility: 'customers', customerIds: ['x', 'cust-1'] })
      assert.equal(run(input({ code: d, lines: bag })).rejected, null)
    })
    it('customer id not in list fails', () => {
      const d = discount({ eligibility: 'customers', customerIds: ['x', 'y'] })
      expectRejected(run(input({ code: d, lines: bag })), 'DISCOUNT_NOT_ELIGIBLE')
    })
    it('guest at checkout cannot match a customers list', () => {
      const d = discount({ eligibility: 'customers', customerIds: ['cust-1'] })
      const c = guest({ email: 'ana@example.com' })
      expectRejected(run(input({ code: d, lines: bag, customer: c, stage: 'checkout' })), 'DISCOUNT_NOT_ELIGIBLE')
    })
  })

  describe('per-customer limit', () => {
    it('redemptions below the limit pass', () => {
      const d = discount({ perCustomerLimit: 2 })
      const r = run(input({ code: d, lines: bag, customer: customer({ redemptions: { [d.id]: 1 } }) }))
      assert.equal(r.rejected, null)
    })
    it('redemptions at the limit -> DISCOUNT_CUSTOMER_LIMIT', () => {
      const d = discount({ perCustomerLimit: 2 })
      const r = run(input({ code: d, lines: bag, customer: customer({ redemptions: { [d.id]: 2 } }) }))
      expectRejected(r, 'DISCOUNT_CUSTOMER_LIMIT')
      assert.deepEqual(r.applied, [])
    })
    it('redemptions of other discounts do not count', () => {
      const d = discount({ perCustomerLimit: 1 })
      const r = run(input({ code: d, lines: bag, customer: customer({ redemptions: { 'other-id': 5 } }) }))
      assert.equal(r.rejected, null)
    })
    it('guest without email at cart passes provisionally', () => {
      const d = discount({ perCustomerLimit: 1 })
      assert.equal(run(input({ code: d, lines: bag, customer: guest() })).rejected, null)
    })
    it('guest at checkout matched by email at the limit fails', () => {
      const d = discount({ perCustomerLimit: 1 })
      const c = guest({ email: 'g@example.com', redemptions: { [d.id]: 1 } })
      expectRejected(run(input({ code: d, lines: bag, customer: c, stage: 'checkout' })), 'DISCOUNT_CUSTOMER_LIMIT')
    })
    it('automatic at its per-customer limit silently does not apply', () => {
      const a = automatic({ perCustomerLimit: 1 })
      const r = run(input({ automatic: [a], lines: bag, customer: customer({ redemptions: { [a.id]: 1 } }) }))
      assert.deepEqual(r.applied, [])
      assert.equal(r.rejected, null)
    })
  })

  describe('stages', () => {
    it('the same signed-in failure is reported at both cart and checkout', () => {
      const d = discount({ eligibility: 'first_order' })
      const c = customer({ paidOrders: 1 })
      expectRejected(run(input({ code: d, lines: bag, customer: c, stage: 'cart' })), 'DISCOUNT_NOT_ELIGIBLE')
      expectRejected(run(input({ code: d, lines: bag, customer: c, stage: 'checkout' })), 'DISCOUNT_NOT_ELIGIBLE')
    })
    it('everyone eligibility never depends on the customer', () => {
      const d = discount({ eligibility: 'everyone' })
      assert.equal(run(input({ code: d, lines: bag, customer: guest() })).rejected, null)
      assert.equal(run(input({ code: d, lines: bag, customer: guest({ email: 'g@x.com' }), stage: 'checkout' })).rejected, null)
    })
  })
})
