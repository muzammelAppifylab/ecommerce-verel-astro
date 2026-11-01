/* Port of VARELStore.totals() — the single place money is computed. Discounts come from the promotions
   engine (evaluatePromotions in ./discounts.ts); this only turns its result into bag/order totals.
   Tax (docs/PHASE2-3.md §1):
   - exclusive (default): tax = round2(taxableMerch × rate) + (taxShipping ? round2(shipping × rate) : 0), added to the total;
   - inclusive: prices already contain tax, so tax = taxable − taxable / (1 + rate) is extracted and nothing is added.
   taxableMerch is the merchandise after discounts, without digital lines when taxDigital is false. */
import { money, round2 } from './money'
import type { EngineDiscount, EngineResult } from './promotions-types'
import type { AppliedDiscountSummary, Totals } from './contract-types'

/** Defaults only: the Worker passes the values from the Setting row (lib/settings.ts). */
export const FREE_THRESHOLD = 150
export const TAX: TaxOptions = { rate: 0.25, name: 'VAT' }

export interface TotalsLine {
  total: number
  qty: number
  digital: boolean
  /** Discount allocated to the line (CartLine.discount); when absent the bag discount is shared pro rata. */
  discount?: number
}

export interface TaxOptions {
  rate: number
  name: string
  /** Prices already include tax (default false) */
  pricesIncludeTax?: boolean
  /** Tax digital lines (default true) */
  taxDigital?: boolean
  /** Tax shipping (default false) */
  taxShipping?: boolean
}

export interface TotalsOptions {
  /** Engine result for this bag (null/undefined = no discounts). */
  promotions?: EngineResult | null
  /** The discounts the engine was given (to label the applied ones). */
  discounts?: EngineDiscount[]
  /** Rate of the selected shipping method; 0 when none is chosen yet. */
  shippingRate?: number | null
  /** Tax from settings / the shipping country's rate (default 25% VAT, exclusive). */
  tax?: TaxOptions
  /** Free-shipping threshold from settings (default $150). */
  freeThreshold?: number
  /** Store currency for labels (default: the store currency, USD). */
  currency?: string
  /** Translator for shippingLabel / taxLabel / summary labels (serverT bound to the request locale). Default: English. */
  t?: LabelT
}

/** serverT-shaped translator; the default fills the English fallback. */
export type LabelT = (key: string, vars: Record<string, string | number>, fallback: string) => string
const englishT: LabelT = (_k, vars, fallback) => fallback.replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n] ?? `{${n}}`))

/** 0.25 → "25", 0.0825 → "8.25" */
export const ratePercent = (rate: number) => String(Math.round(rate * 10_000) / 100)

/** Tax contained in a gross amount: gross − gross / (1 + rate). */
export const includedTax = (gross: number, rate: number) => (rate > 0 ? round2(gross - gross / (1 + rate)) : 0)

/** Merchandise the tax applies to, after discounts (digital lines left out when taxDigital is false). */
export function taxableMerchandise(lines: TotalsLine[], discount: number, taxDigital = true): number {
  const subtotal = lines.reduce((n, l) => n + l.total, 0)
  const explicit = lines.some((l) => l.discount != null)
  let taxable = 0
  for (const l of lines) {
    if (l.digital && !taxDigital) continue
    const share = explicit ? (l.discount ?? 0) : subtotal > 0 ? (discount * l.total) / subtotal : 0
    taxable += Math.max(0, l.total - share)
  }
  return round2(taxable)
}

/** "Autumn knitwear · 15% off", "STUDIO10 · 10% off" */
export function summaryLabel(d: { method: string; name: string; label: string }, code: string | null, t: LabelT = englishT): string {
  const head = d.method === 'automatic' ? d.name : (code ?? d.name)
  return head && head !== d.label ? t('discount.summary', { head, label: d.label }, '{head} · {label}') : d.label
}

export function summariesOf(result: EngineResult | null | undefined, discounts: EngineDiscount[] = [], t: LabelT = englishT): AppliedDiscountSummary[] {
  if (!result) return []
  return result.applied.map((a) => {
    const d = discounts.find((x) => x.id === a.discountId)
    return {
      id: a.discountId,
      label: d ? summaryLabel(d, a.code, t) : a.label,
      code: a.code,
      automatic: a.method === 'automatic',
      amount: a.amount,
      freeShipping: a.freeShipping,
    }
  })
}

/** The shipping rate a free-shipping discount saves: 0 when the bag is digital or ships free anyway (merchandise
    after its other discounts at or over the threshold). */
export function shippingValue(lines: TotalsLine[], rate: number | null | undefined, freeThreshold = FREE_THRESHOLD, discount = 0): number {
  const net = round2(lines.reduce((n, l) => n + l.total, 0) - discount)
  const physical = lines.some((l) => !l.digital)
  return !physical || net >= freeThreshold ? 0 : round2(rate ?? 0)
}

export function computeTotals(lines: TotalsLine[], opts: TotalsOptions = {}): Totals {
  const subtotal = round2(lines.reduce((n, l) => n + l.total, 0))
  const t = opts.t ?? englishT
  const r = opts.promotions ?? null
  const taxCfg = opts.tax ?? TAX
  const threshold = opts.freeThreshold ?? FREE_THRESHOLD
  const discount = round2(Math.min(subtotal, r?.discountTotal ?? 0))
  const net = round2(Math.max(0, subtotal - discount))
  // The free-shipping threshold is measured on the merchandise after discounts.
  const freeShip = net >= threshold || !!r?.freeShipping
  const physical = lines.some((l) => !l.digital)
  const shipping = !physical ? 0 : freeShip ? 0 : round2(opts.shippingRate ?? 0)
  const inclusive = !!taxCfg.pricesIncludeTax
  const rate = Math.max(0, taxCfg.rate)
  const taxable = taxableMerchandise(lines, discount, taxCfg.taxDigital ?? true)
  const taxedShipping = taxCfg.taxShipping ? shipping : 0
  const tax = inclusive
    ? round2(includedTax(taxable, rate) + includedTax(taxedShipping, rate))
    : round2(round2(taxable * rate) + round2(taxedShipping * rate))
  const total = round2(net + shipping + (inclusive ? 0 : tax))
  return {
    subtotal,
    discount,
    discountCode: r?.applied.find((a) => a.method === 'code')?.code ?? null,
    discounts: summariesOf(r, opts.discounts, t),
    shipping,
    shippingLabel: !physical
      ? t('totals.shippingDigital', {}, 'No shipping · digital')
      : shipping === 0
        ? t('totals.shippingFree', {}, 'Free')
        : money(shipping, opts.currency),
    tax,
    taxName: t(`taxName.${taxCfg.name}`, {}, taxCfg.name),
    taxRate: taxCfg.rate,
    total,
    toFree: round2(Math.max(0, threshold - net)),
    freeThreshold: threshold,
    count: lines.reduce((n, l) => n + l.qty, 0),
    physical,
    pricesIncludeTax: inclusive,
    taxLabel: inclusive
      ? t('totals.taxIncluded', { amount: money(tax, opts.currency), tax: t(`taxName.${taxCfg.name}`, {}, taxCfg.name) }, 'Includes {amount} {tax}')
      : t('totals.taxRate', { tax: t(`taxName.${taxCfg.name}`, {}, taxCfg.name), rate: ratePercent(rate) }, '{tax} {rate}%'),
  }
}
