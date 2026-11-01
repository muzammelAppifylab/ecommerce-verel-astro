/* The promotions engine — docs/PROMOTIONS.md ("Engine rules"). Contract: ./promotions-types.ts.

   evaluatePromotions() is PURE: no database, no clock (it takes `now`), no mutation of its input.
   Cart totals, checkout, the admin and the tests all go through it. Loading discounts, customer history
   and bag lines happens in ./promotions-loader.ts.

   Money is handled in integer cents internally and returned in dollars rounded to cents. */
import type {
  AppliedDiscount,
  DiscountErrorCode,
  EngineCustomer,
  EngineDiscount,
  EngineInput,
  EngineLine,
  EngineResult,
} from './promotions-types'
import { money } from './money'

export type { DiscountErrorCode } from './promotions-types'

// ─── Cents ──────────────────────────────────────────────────────────────────

const toC = (dollars: number): number => Math.round(dollars * 100 + (dollars >= 0 ? 1e-7 : -1e-7))
const roundC = (cents: number): number => Math.round(cents + 1e-7)
const toD = (cents: number): number => cents / 100

// ─── Scope ──────────────────────────────────────────────────────────────────

export function lineInScope(d: Pick<EngineDiscount, 'scope' | 'productIds' | 'categoryIds' | 'departmentIds'>, l: Pick<EngineLine, 'productId' | 'categoryId' | 'departmentId'>): boolean {
  switch (d.scope) {
    case 'order':
      return true
    case 'products':
      return d.productIds.includes(l.productId)
    case 'categories':
      return d.categoryIds.includes(l.categoryId)
    case 'departments':
      return d.departmentIds.includes(l.departmentId)
  }
}

/** Units needed before a discount can apply: its own minimum, and a full group for buy X get Y. */
export function requiredQty(d: Pick<EngineDiscount, 'kind' | 'minimumQty' | 'buyQty' | 'getQty'>): number {
  const own = d.minimumQty ?? 0
  const group = d.kind === 'bxgy' ? Math.max(1, d.buyQty ?? 0) + Math.max(1, d.getQty ?? 0) : 0
  return Math.max(own, group)
}

// ─── Messages (VAREL voice: sentence case, specific, no exclamation marks) ───

/** What the customer calls a discount: the code they typed, or the promotion's name. */
const nameOf = (d: EngineDiscount, entered: string | null) => (d.method === 'automatic' ? d.name : (entered ?? d.code ?? d.name))

/** English text with `{name}` placeholders filled — the engine's default translator (keeps the engine pure). */
const englishT = (_key: string, vars: Record<string, string | number>, fallback: string) =>
  fallback.replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n] ?? `{${n}}`))

type T = NonNullable<EngineInput['t']>

/** "T-shirts", "knitwear", "pieces" — the scope in words, for messages. */
const scopeWords = (d: EngineDiscount, t: T) =>
  d.scopeLabel?.trim() || (d.scope === 'order' ? t('discount.scope.pieces', {}, 'pieces') : t('discount.scope.eligible', {}, 'eligible pieces'))

function message(
  code: DiscountErrorCode,
  d: EngineDiscount | null,
  entered: string | null,
  ctx: { inScopeQty?: number; inScopeSpend?: number } = {},
  t: T = englishT,
): string {
  const name = d ? nameOf(d, entered) : (entered ?? t('discount.thatCode', {}, 'That code'))
  switch (code) {
    case 'DISCOUNT_INVALID':
      return t('discount.invalid', { name }, '{name} is not a valid code. Check the spelling and try again')
    case 'DISCOUNT_INACTIVE':
      return t('discount.inactive', { name }, '{name} is no longer active')
    case 'DISCOUNT_NOT_STARTED':
      return t('discount.notStarted', { name }, '{name} is not active yet')
    case 'DISCOUNT_EXPIRED':
      return t('discount.expired', { name }, '{name} has expired')
    case 'DISCOUNT_USED_UP':
      return d?.codeType === 'unique' && d.uniqueCodeUsed
        ? t('discount.alreadyUsed', { name }, '{name} has already been used')
        : t('discount.usageLimit', { name }, '{name} has reached its usage limit')
    case 'DISCOUNT_NOT_ELIGIBLE':
      switch (d?.eligibility) {
        case 'first_order':
          return t('discount.firstOrder', { name }, '{name} is for first orders only')
        case 'signed_in':
          return t('discount.signIn', { name }, 'Sign in to use {name}')
        case 'subscribers':
          return t('discount.subscribers', { name }, '{name} is for newsletter subscribers only')
        default:
          return t('discount.notAvailable', { name }, '{name} is not available on your account')
      }
    case 'DISCOUNT_CUSTOMER_LIMIT': {
      const limit = d?.perCustomerLimit ?? 1
      // A batch of unique codes: the limit is per batch, so name the promotion rather than this code.
      if (d?.codeType === 'unique' && d.name) {
        return limit <= 1
          ? t('discount.batchUsedOnce', { name: d.name }, 'You have already used a {name} code')
          : t('discount.batchUsedMany', { name: d.name, limit }, 'You have already used {name} codes {limit} times, the most it allows')
      }
      return limit <= 1
        ? t('discount.usedOnce', { name }, 'You have already used {name}')
        : t('discount.usedMany', { name, limit }, 'You have already used {name} {limit} times, the most it allows')
    }
    case 'DISCOUNT_NOT_APPLICABLE':
      return d && d.scope !== 'order'
        ? t('discount.notInBag', { name, scope: scopeWords(d, t) }, '{name} applies to {scope} only, and there are none in your bag')
        : t('discount.emptyBag', { name }, 'Add a piece to your bag to use {name}')
    case 'DISCOUNT_MIN_QTY': {
      const need = d ? requiredQty(d) : 0
      return t('discount.minQty', { name, need, scope: scopeWords(d!, t) }, '{name} needs {need} or more {scope} in your bag')
    }
    case 'DISCOUNT_MINIMUM': {
      const min = money(d?.minimum ?? 0)
      const short = money(Math.max(0, toD(toC(d?.minimum ?? 0) - toC(ctx.inScopeSpend ?? 0))))
      return d && d.scope !== 'order'
        ? t('discount.minimumScoped', { name, min, short, scope: scopeWords(d, t) }, '{name} needs a minimum spend of {min} on {scope}. Add {short} more to use it')
        : t('discount.minimum', { name, min, short }, '{name} needs a minimum spend of {min}. Add {short} more to use it')
    }
    case 'DISCOUNT_NOT_COMBINABLE':
      return t('discount.notCombinable', {}, 'A better offer is already applied to your bag')
  }
}

// ─── Validity ───────────────────────────────────────────────────────────────

const CUSTOMER_CHECKS: DiscountErrorCode[] = ['DISCOUNT_NOT_ELIGIBLE', 'DISCOUNT_CUSTOMER_LIMIT']
/** Errors that depend on who the customer is (checkout fails on these instead of quietly dropping the code). */
export const isCustomerError = (code: string) => (CUSTOMER_CHECKS as string[]).includes(code)

function eligible(d: EngineDiscount, c: EngineCustomer): boolean {
  switch (d.eligibility) {
    case 'everyone':
      return true
    case 'signed_in':
      return c.signedIn
    case 'first_order':
      return c.paidOrders === 0
    case 'subscribers':
      return c.subscriber
    case 'customers':
      return !!c.id && d.customerIds.includes(c.id)
  }
}

/** The first failing check, in the documented order, or null when the discount can apply to this bag. */
export function validity(d: EngineDiscount, inp: Pick<EngineInput, 'lines' | 'customer' | 'stage' | 'now'>): DiscountErrorCode | null {
  const { customer: c, now } = inp
  if (!d.active) return 'DISCOUNT_INACTIVE'
  if (d.startsAt && d.startsAt.getTime() > now.getTime()) return 'DISCOUNT_NOT_STARTED'
  if (d.endsAt && d.endsAt.getTime() <= now.getTime()) return 'DISCOUNT_EXPIRED'
  if (d.usageLimit != null && d.used >= d.usageLimit) return 'DISCOUNT_USED_UP'
  if (d.codeType === 'unique' && d.method === 'code' && d.uniqueCodeUsed) return 'DISCOUNT_USED_UP'
  // Customer-dependent checks: final at checkout; at the cart only once we know who the customer is.
  const known = inp.stage === 'checkout' || c.signedIn || !!c.email
  if (known) {
    if (!eligible(d, c)) return 'DISCOUNT_NOT_ELIGIBLE'
    if (d.perCustomerLimit != null && (c.redemptions[d.id] ?? 0) >= d.perCustomerLimit) return 'DISCOUNT_CUSTOMER_LIMIT'
  }
  const scoped = inp.lines.filter((l) => l.qty > 0 && lineInScope(d, l))
  if (!scoped.length) return 'DISCOUNT_NOT_APPLICABLE'
  const qty = scoped.reduce((n, l) => n + l.qty, 0)
  if (qty < requiredQty(d)) return 'DISCOUNT_MIN_QTY'
  const spend = scoped.reduce((n, l) => n + toC(l.unit) * l.qty, 0)
  if (spend < toC(d.minimum)) return 'DISCOUNT_MINIMUM'
  return null
}

// ─── Amounts ────────────────────────────────────────────────────────────────

interface Slot {
  lineId: string
  weight: number // proportional share (cents, may be fractional)
  cap: number // what is left on the line (cents)
}

/** Split `total` cents across slots in proportion to weight, rounding each to the cent and letting the last
    slot take the remainder. Never exceeds a slot's cap; the result sums exactly to `total`. */
function allocate(total: number, slots: Slot[]): number[] {
  const out = slots.map(() => 0)
  const live = slots.map((s, i) => ({ ...s, i })).filter((s) => s.weight > 0 && s.cap > 0)
  if (!live.length || total <= 0) return out
  total = Math.min(total, live.reduce((n, s) => n + s.cap, 0))
  const W = live.reduce((n, s) => n + s.weight, 0)
  let acc = 0
  for (let k = 0; k < live.length - 1; k++) {
    const s = live[k]
    const p = Math.min(s.cap, roundC((total * s.weight) / W))
    out[s.i] = p
    acc += p
  }
  const last = live[live.length - 1]
  let rest = total - acc
  if (rest > last.cap) {
    out[last.i] = last.cap
    rest -= last.cap
    for (const s of live) {
      if (rest <= 0) break
      const room = s.cap - out[s.i]
      const add = Math.min(room, rest)
      out[s.i] += add
      rest -= add
    }
  } else if (rest < 0) {
    let deficit = -rest
    for (let k = live.length - 2; k >= 0 && deficit > 0; k--) {
      const take = Math.min(out[live[k].i], deficit)
      out[live[k].i] -= take
      deficit -= take
    }
  } else {
    out[last.i] = rest
  }
  return out
}

/** Merchandise cents a discount takes from what is left of each line (`remaining`, cents per line id). */
function amountsFor(d: EngineDiscount, lines: EngineLine[], remaining: Map<string, number>): number[] {
  const scoped = lines.map((l) => l.qty > 0 && lineInScope(d, l))
  const rem = lines.map((l, i) => (scoped[i] ? (remaining.get(l.lineId) ?? 0) : 0))
  const slots = (weights: number[]): Slot[] => lines.map((l, i) => ({ lineId: l.lineId, weight: weights[i], cap: rem[i] }))
  const sumRem = rem.reduce((n, x) => n + x, 0)

  switch (d.kind) {
    case 'shipping':
      return lines.map(() => 0)
    case 'percent': {
      const pct = Math.min(100, Math.max(0, d.value))
      let total = roundC((sumRem * pct) / 100)
      if (d.maxAmount != null) total = Math.min(total, toC(d.maxAmount))
      return allocate(Math.min(total, sumRem), slots(rem))
    }
    case 'fixed':
      return allocate(Math.min(toC(Math.max(0, d.value)), sumRem), slots(rem))
    case 'bxgy': {
      const buy = Math.max(1, d.buyQty ?? 1)
      const get = Math.max(1, d.getQty ?? 1)
      const pct = Math.min(100, Math.max(0, d.getPercent ?? 100))
      // Expand in-scope units, most expensive first (stable on bag order).
      const units: number[] = []
      lines.forEach((l, i) => {
        if (scoped[i]) for (let u = 0; u < l.qty; u++) units.push(i)
      })
      units.sort((a, b) => toC(lines[b].unit) - toC(lines[a].unit) || a - b)
      const freeUnits = lines.map(() => 0)
      const size = buy + get
      for (let g = 0; (g + 1) * size <= units.length; g++) {
        for (let k = g * size + buy; k < (g + 1) * size; k++) freeUnits[units[k]]++
      }
      const raw = lines.map((l, i) => (freeUnits[i] && l.qty ? ((rem[i] / l.qty) * freeUnits[i] * pct) / 100 : 0))
      const total = roundC(raw.reduce((n, x) => n + x, 0))
      return allocate(total, slots(raw))
    }
  }
}

// ─── Combining ──────────────────────────────────────────────────────────────

/** Application order: priority (higher first); ties: code before automatic, then older first, then id. */
function byPriority(a: EngineDiscount, b: EngineDiscount): number {
  return (
    b.priority - a.priority ||
    (a.method === b.method ? 0 : a.method === 'code' ? -1 : 1) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

interface Outcome {
  applied: AppliedDiscount[]
  merchCents: number
  freeShipping: boolean
}

/** Apply `set` (already compatible) in priority order on the lines' remaining amounts. */
function applySet(set: EngineDiscount[], inp: EngineInput, codeId: string | null): Outcome {
  const remaining = new Map(inp.lines.map((l) => [l.lineId, Math.max(0, toC(l.unit) * l.qty)]))
  const applied: AppliedDiscount[] = []
  let merchCents = 0
  let freeShipping = false
  for (const d of [...set].sort(byPriority)) {
    const parts = amountsFor(d, inp.lines, remaining)
    const amount = parts.reduce((n, x) => n + x, 0)
    const isCode = d.id === codeId
    // An automatic that has nothing left to take is not applied (the code always is: the customer asked for it).
    if (!isCode && d.kind !== 'shipping' && amount === 0) continue
    inp.lines.forEach((l, i) => remaining.set(l.lineId, (remaining.get(l.lineId) ?? 0) - parts[i]))
    merchCents += amount
    if (d.kind === 'shipping') freeShipping = true
    applied.push({
      discountId: d.id,
      method: d.method,
      code: d.method === 'code' ? (inp.codeEntered?.trim().toUpperCase() || d.code) : null,
      label: d.label,
      amount: toD(amount),
      freeShipping: d.kind === 'shipping',
      allocations: d.kind === 'shipping' ? [] : inp.lines.flatMap((l, i) => (parts[i] > 0 ? [{ lineId: l.lineId, amount: toD(parts[i]) }] : [])),
    })
  }
  return { applied, merchCents, freeShipping }
}

/** Every allowed set (rule 5): each non-combinable discount on its own, and all combinable ones together. */
function candidateSets(valid: EngineDiscount[]): EngineDiscount[][] {
  const sets = valid.filter((d) => !d.combinable).map((d) => [d])
  const together = valid.filter((d) => d.combinable)
  if (together.length) sets.push(together)
  return sets
}

/** The first discount of a set in application order. */
const topOf = (set: EngineDiscount[]) => [...set].sort(byPriority)[0]

export function evaluatePromotions(inp: EngineInput): EngineResult {
  const shippingCents = Math.max(0, toC(inp.shippingRate || 0))
  // Shipping still charged after an outcome: free with a free-shipping discount, or when the merchandise after its
  // discounts reaches the free-shipping threshold (when one is given). An outcome's value is what it takes off the
  // merchandise minus the shipping left to pay, so sets compare on what the customer actually pays.
  const thresholdCents = inp.freeThreshold != null ? toC(inp.freeThreshold) : null
  const physical = inp.lines.some((l) => !l.digital && l.qty > 0)
  const subtotalCents = inp.lines.reduce((n, l) => n + toC(l.unit) * Math.max(0, l.qty), 0)
  const shippingAfter = (o: Outcome) =>
    o.freeShipping || (thresholdCents != null && (!physical || subtotalCents - o.merchCents >= thresholdCents)) ? 0 : shippingCents
  const value = (o: Outcome) => o.merchCents - shippingAfter(o)
  const autos = inp.automatic.filter((d) => d.method === 'automatic' && validity(d, inp) === null)

  let rejected: EngineResult['rejected'] = null
  let code: EngineDiscount | null = null
  if (inp.codeEntered != null && inp.codeEntered.trim() !== '') {
    if (!inp.code) {
      rejected = { code: 'DISCOUNT_INVALID', message: message('DISCOUNT_INVALID', null, inp.codeEntered.trim().toUpperCase(), {}, inp.t) }
    } else {
      const err = validity(inp.code, inp)
      if (err) {
        const scoped = inp.lines.filter((l) => lineInScope(inp.code!, l))
        const spend = scoped.reduce((n, l) => n + l.unit * l.qty, 0)
        rejected = { code: err, message: message(err, inp.code, inp.codeEntered.trim().toUpperCase(), { inScopeSpend: spend }, inp.t) }
      } else code = inp.code
    }
  } else if (inp.code) {
    // A discount passed without the typed code (e.g. a direct caller): validate it the same way.
    const err = validity(inp.code, inp)
    if (err) rejected = { code: err, message: message(err, inp.code, inp.code.code, {}, inp.t) }
    else code = inp.code
  }

  // Rule 5: evaluate every allowed set and keep the one that saves the customer the most.
  // Ties: the set with the entered code, then the higher-priority top discount, then the older one.
  const valid = code ? [...autos, code] : autos
  let chosen: Outcome = { applied: [], merchCents: 0, freeShipping: false }
  let chosenSet: EngineDiscount[] = []
  let chosenValue = -Infinity // values can be negative: shipping left to pay is subtracted
  // With the threshold measured after discounts, an automatic discount can cost more in shipping than it saves.
  // Without an entered code (which the customer chose), applying nothing is a candidate too.
  const sets = candidateSets(valid)
  if (thresholdCents != null && !code) sets.push([])
  for (const set of sets) {
    const outcome = applySet(set, inp, code?.id ?? null)
    const v = value(outcome)
    let better = v > chosenValue
    if (v === chosenValue) {
      const hasCode = !!code && set.includes(code)
      const hadCode = !!code && chosenSet.includes(code)
      if (hasCode !== hadCode) better = hasCode
      // Equal value: apply the discounts rather than nothing.
      else if (!set.length || !chosenSet.length) better = set.length > 0
      else better = byPriority(topOf(set), topOf(chosenSet)) < 0
    }
    if (better) {
      chosen = outcome
      chosenSet = set
      chosenValue = v
    }
  }
  if (code && !chosen.applied.some((a) => a.discountId === code!.id)) {
    rejected = { code: 'DISCOUNT_NOT_COMBINABLE', message: message('DISCOUNT_NOT_COMBINABLE', code, inp.codeEntered, {}, inp.t) }
  }

  const lineDiscounts: Record<string, number> = {}
  for (const l of inp.lines) {
    const c = chosen.applied.reduce((n, a) => n + toC(a.allocations.find((x) => x.lineId === l.lineId)?.amount ?? 0), 0)
    lineDiscounts[l.lineId] = toD(c)
  }
  return {
    applied: chosen.applied,
    rejected,
    discountTotal: toD(chosen.merchCents),
    freeShipping: chosen.freeShipping,
    lineDiscounts,
  }
}

// ─── Small helpers for callers ──────────────────────────────────────────────

/** Errors that still let a code stay on the bag (it can apply once the bag changes). */
export const KEEPS_CODE: DiscountErrorCode[] = ['DISCOUNT_MINIMUM', 'DISCOUNT_MIN_QTY']

/** Value of an automatic discount for one unit of a product — used to pick `Product.promotion`. */
export function unitValue(d: EngineDiscount, unit: number): number {
  switch (d.kind) {
    case 'percent': {
      const v = (unit * Math.min(100, Math.max(0, d.value))) / 100
      return d.maxAmount != null ? Math.min(v, d.maxAmount) : v
    }
    case 'fixed':
      return Math.min(unit, d.value)
    case 'bxgy': {
      const buy = Math.max(1, d.buyQty ?? 1)
      const get = Math.max(1, d.getQty ?? 1)
      return (unit * get * ((d.getPercent ?? 100) / 100)) / (buy + get)
    }
    case 'shipping':
      return 0
  }
}
