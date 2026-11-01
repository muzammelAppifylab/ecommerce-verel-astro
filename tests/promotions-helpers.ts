/* Builders and invariant checks for the promotions engine tests (docs/PROMOTIONS.md, "Engine rules"). */
import assert from 'node:assert/strict'
import { evaluatePromotions } from '../src/server/lib/discounts'
import type {
  EngineCustomer,
  EngineDiscount,
  EngineInput,
  EngineLine,
  EngineResult,
  DiscountErrorCode,
} from '../src/server/lib/promotions-types'

export const NOW = new Date('2026-10-21T12:00:00.000Z')
export const DAY = 24 * 60 * 60 * 1000
export const daysFromNow = (n: number) => new Date(NOW.getTime() + n * DAY)

export function line(over: Partial<EngineLine> = {}): EngineLine {
  return {
    lineId: 'l1',
    productId: 'p1',
    categoryId: 'c1',
    departmentId: 'd1',
    unit: 50,
    qty: 1,
    digital: false,
    ...over,
  }
}

let seq = 0
export function discount(over: Partial<EngineDiscount> = {}): EngineDiscount {
  seq += 1
  const method = over.method ?? 'code'
  const id = over.id ?? `disc-${seq}`
  return {
    id,
    method,
    name: `Discount ${id}`,
    code: method === 'code' ? `CODE${seq}` : null,
    codeType: 'shared',
    kind: 'percent',
    value: 10,
    maxAmount: null,
    buyQty: null,
    getQty: null,
    getPercent: null,
    scope: 'order',
    productIds: [],
    categoryIds: [],
    departmentIds: [],
    minimum: 0,
    minimumQty: null,
    eligibility: 'everyone',
    customerIds: [],
    usageLimit: null,
    perCustomerLimit: null,
    combinable: false,
    priority: 0,
    label: `Label ${id}`,
    active: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    used: 0,
    ...over,
  }
}

export const automatic = (over: Partial<EngineDiscount> = {}) => discount({ method: 'automatic', code: null, ...over })

/** Signed-in customer with no history by default. */
export function customer(over: Partial<EngineCustomer> = {}): EngineCustomer {
  return {
    id: 'cust-1',
    email: 'ana@example.com',
    signedIn: true,
    paidOrders: 0,
    subscriber: false,
    redemptions: {},
    ...over,
  }
}

/** Guest at the cart stage: no account, no email. */
export const guest = (over: Partial<EngineCustomer> = {}) =>
  customer({ id: null, email: null, signedIn: false, ...over })

export function input(over: Partial<EngineInput> = {}): EngineInput {
  const code = over.code ?? null
  return {
    lines: [line()],
    code,
    codeEntered: code ? (code.code ?? 'UNIQUE-CODE') : null,
    automatic: [],
    customer: customer(),
    stage: 'cart',
    shippingRate: 0,
    now: NOW,
    ...over,
  }
}

const c = (x: number) => Math.round(x * 100)

/** Money equality to the cent, and the actual value must itself be a whole number of cents. */
export function money(actual: number | undefined, expected: number, msg?: string) {
  assert.equal(typeof actual, 'number', `${msg ?? 'amount'}: expected a number, got ${actual}`)
  const a = actual as number
  assert.ok(Math.abs(a * 100 - Math.round(a * 100)) < 1e-6, `${msg ?? 'amount'}: ${a} is not rounded to cents`)
  assert.equal(c(a), c(expected), `${msg ?? 'amount'}: expected ${expected}, got ${a}`)
}

/** Spec-wide invariants checked on every result. */
export function checkInvariants(inp: EngineInput, r: EngineResult) {
  const lineIds = new Set(inp.lines.map((l) => l.lineId))
  const perLine: Record<string, number> = {}
  let total = 0
  for (const a of r.applied) {
    let sum = 0
    for (const al of a.allocations) {
      assert.ok(lineIds.has(al.lineId), `allocation to unknown line ${al.lineId}`)
      assert.ok(al.amount >= 0, `negative allocation ${al.amount} on ${al.lineId}`)
      sum += c(al.amount)
      perLine[al.lineId] = (perLine[al.lineId] ?? 0) + c(al.amount)
    }
    assert.equal(sum, c(a.amount), `allocations of ${a.discountId} sum to ${sum / 100}, amount ${a.amount}`)
    total += c(a.amount)
  }
  assert.equal(c(r.discountTotal), total, `discountTotal ${r.discountTotal} != sum of applied amounts ${total / 100}`)
  for (const l of inp.lines) {
    const expected = perLine[l.lineId] ?? 0
    assert.equal(c(r.lineDiscounts[l.lineId] ?? 0), expected, `lineDiscounts[${l.lineId}] != sum of allocations`)
    assert.ok(expected <= c(l.unit * l.qty), `line ${l.lineId} discounted below $0`)
  }
  assert.equal(r.freeShipping, r.applied.some((a) => a.freeShipping), 'freeShipping flag mismatch with applied')
  if (r.rejected) assert.ok(r.rejected.message.length > 0, 'rejection needs a message')
}

export function run(inp: EngineInput): EngineResult {
  const r = evaluatePromotions(inp)
  checkInvariants(inp, r)
  return r
}

export function expectRejected(r: EngineResult, code: DiscountErrorCode) {
  assert.equal(r.rejected?.code, code, `expected rejection ${code}, got ${JSON.stringify(r.rejected)}`)
}

export function appliedIds(r: EngineResult) {
  return r.applied.map((a) => a.discountId)
}

export function find(r: EngineResult, id: string) {
  const a = r.applied.find((x) => x.discountId === id)
  assert.ok(a, `discount ${id} not applied; applied=${JSON.stringify(appliedIds(r))} rejected=${JSON.stringify(r.rejected)}`)
  return a
}

export function alloc(r: EngineResult, id: string, lineId: string) {
  return find(r, id).allocations.find((x) => x.lineId === lineId)?.amount ?? 0
}
