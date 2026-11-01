/* Promotions admin: derived fields (status, plain-language summary, default label/note), grouped stats and the
   AdminDiscount serializer (port of VAREL worker/routes/admin/discount-shared.ts). Stats and target names are
   loaded with a fixed number of queries per request (no N+1).

   The database keeps F1's columns (`percentOff` for percent, `amountCents` for fixed, cents everywhere, Int ids
   for categories/departments/customers); the wire and the rule helpers keep VAREL's numbers in currency units and
   string ids. `stateOf` / `toColumns` convert at the boundary. */
import {Prisma} from '../../../generated/prisma/client';
import type {
  AdminDiscount,
  DiscountCodeType,
  DiscountEligibility,
  DiscountKind,
  DiscountMethod,
  DiscountScope,
  DiscountStatus,
} from '../../../lib/types/admin/promotions';
import type {Db} from '../../lib/db';
import {fromCents, fromCentsOrNull, getStoreCurrency, money, num, toCents, toCentsOrNull} from '../../lib/money';
import {getSettings} from '../../lib/settings';

// ─── Columns ────────────────────────────────────────────────────────────────

/** Every scalar column of `discounts` (no relations): what the serializer and the editor read. */
export const DISCOUNT_SELECT = {
  id: true,
  method: true,
  name: true,
  code: true,
  codeType: true,
  kind: true,
  percentOff: true,
  amountCents: true,
  maxAmountCents: true,
  buyQty: true,
  getQty: true,
  getPercent: true,
  scope: true,
  productIds: true,
  categoryIds: true,
  departmentIds: true,
  label: true,
  minimumCents: true,
  minimumQty: true,
  eligibility: true,
  customerIds: true,
  perCustomerLimit: true,
  combinable: true,
  priority: true,
  note: true,
  active: true,
  startsAt: true,
  endsAt: true,
  usageLimit: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DiscountSelect;

export type DiscountRow = Prisma.DiscountGetPayload<{select: typeof DISCOUNT_SELECT}>;

/** Every stored rule field in wire terms (what create/update writes): money in currency units, ids as strings. */
export interface State {
  method: DiscountMethod;
  name: string;
  code: string | null;
  codeType: DiscountCodeType;
  kind: DiscountKind;
  value: number;
  maxAmount: number | null;
  buyQty: number | null;
  getQty: number | null;
  getPercent: number | null;
  scope: DiscountScope;
  productIds: string[];
  categoryIds: string[];
  departmentIds: string[];
  minimum: number;
  minimumQty: number | null;
  eligibility: DiscountEligibility;
  customerIds: string[];
  usageLimit: number | null;
  perCustomerLimit: number | null;
  combinable: boolean;
  priority: number;
  label: string;
  note: string;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

export const DEFAULTS: State = {
  method: 'code',
  name: '',
  code: null,
  codeType: 'shared',
  kind: 'percent',
  value: 0,
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
  label: '',
  note: '',
  active: true,
  startsAt: null,
  endsAt: null,
};

/** A stored row → its rule in wire terms (`value` = percent off, or the fixed amount, else 0). */
export function stateOf(d: DiscountRow): State {
  const kind = d.kind as DiscountKind;
  return {
    method: d.method as DiscountMethod,
    name: d.name,
    code: d.code,
    codeType: d.codeType as DiscountCodeType,
    kind,
    value: kind === 'percent' ? num(d.percentOff) : kind === 'fixed' ? fromCents(d.amountCents) : 0,
    maxAmount: fromCentsOrNull(d.maxAmountCents),
    buyQty: d.buyQty,
    getQty: d.getQty,
    getPercent: d.getPercent,
    scope: d.scope as DiscountScope,
    productIds: [...d.productIds],
    categoryIds: d.categoryIds.map(String),
    departmentIds: d.departmentIds.map(String),
    minimum: fromCents(d.minimumCents),
    minimumQty: d.minimumQty,
    eligibility: d.eligibility as DiscountEligibility,
    customerIds: d.customerIds.map(String),
    usageLimit: d.usageLimit,
    perCustomerLimit: d.perCustomerLimit,
    combinable: d.combinable,
    priority: d.priority,
    label: d.label,
    note: d.note,
    active: d.active,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
  };
}

/** Digit strings → int4 ids (anything else is dropped: target checks have refused it already). */
export const intIds = (ids: readonly string[]): number[] =>
  ids.filter(id => /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2_147_483_647).map(Number);

/** A rule in wire terms → the columns the promotions engine reads (src/server/lib/promotions-loader.ts). */
export function toColumns(s: State) {
  return {
    method: s.method,
    name: s.name,
    code: s.code,
    codeType: s.codeType,
    kind: s.kind,
    percentOff: s.kind === 'percent' ? new Prisma.Decimal(s.value) : null,
    amountCents: s.kind === 'fixed' ? toCents(s.value) : null,
    maxAmountCents: s.kind === 'percent' ? toCentsOrNull(s.maxAmount) : null,
    buyQty: s.buyQty,
    getQty: s.getQty,
    getPercent: s.getPercent,
    scope: s.scope,
    productIds: s.productIds,
    categoryIds: intIds(s.categoryIds),
    departmentIds: intIds(s.departmentIds),
    label: s.label,
    minimumCents: toCents(s.minimum),
    minimumQty: s.minimumQty,
    eligibility: s.eligibility,
    customerIds: intIds(s.customerIds),
    perCustomerLimit: s.perCustomerLimit,
    combinable: s.combinable,
    priority: s.priority,
    note: s.note,
    active: s.active,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    usageLimit: s.usageLimit,
  } satisfies Prisma.DiscountUncheckedCreateInput;
}

// ─── Customers ──────────────────────────────────────────────────────────────

/**
 * VAREL `role: 'customer'`: a template account whose roles are all `member` (or none). Staff, admins and
 * the owner are never offered in the pickers, nor accepted as targets. Classification, not gating.
 */
export const CUSTOMER_WHERE = {roles: {every: {role: {slug: 'member'}}}} satisfies Prisma.UserWhereInput;

/** Profile first + last name, else the account name ('' when neither). */
export function displayNameOf(u: {name: string; customerProfile: {firstName: string; lastName: string} | null}): string {
  const profile = u.customerProfile ? `${u.customerProfile.firstName} ${u.customerProfile.lastName}`.trim() : '';
  return profile || u.name.trim();
}

// ─── Codes lock ─────────────────────────────────────────────────────────────

/** Serialize writes of codes (shared discount codes and generated unique codes) until the transaction ends, so a
    shared code and a unique code can't both be checked free and then written with the same text. */
export async function lockCodes(tx: Db): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "ok" FROM pg_advisory_xact_lock(731021)`;
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export interface DiscountStats {
  used: number;
  totalDiscounted: number;
  revenue: number;
  codesTotal: number;
  codesUsed: number;
}

export const zeroStats = (): DiscountStats => ({used: 0, totalDiscounted: 0, revenue: 0, codesTotal: 0, codesUsed: 0});

/** Redemption count/sum + order revenue (one grouped query) and unique-code counts (one grouped query), for ≤ 100 ids. */
export async function loadStats(db: Db, ids: number[]): Promise<Map<number, DiscountStats>> {
  const out = new Map<number, DiscountStats>(ids.map(id => [id, zeroStats()]));
  if (!ids.length) return out;
  const [red, codes] = await Promise.all([
    db.$queryRaw<{discountId: number; used: number; amount: bigint | number; revenue: bigint | number}[]>`
      SELECT r.discount_id AS "discountId", COUNT(*)::int AS "used",
             COALESCE(SUM(r.amount_cents) FILTER (WHERE o.payment = 'Paid'), 0)::bigint AS "amount",
             COALESCE(SUM(o.total_cents) FILTER (WHERE o.payment = 'Paid'), 0)::bigint AS "revenue"
      FROM discount_redemptions r JOIN shop_orders o ON o.id = r.order_id
      WHERE r.discount_id IN (${Prisma.join(ids)})
      GROUP BY r.discount_id`,
    db.$queryRaw<{discountId: number; total: number; used: number}[]>`
      SELECT discount_id AS "discountId", COUNT(*)::int AS "total",
             COUNT(*) FILTER (WHERE used_at IS NOT NULL OR order_id IS NOT NULL)::int AS "used"
      FROM discount_codes WHERE discount_id IN (${Prisma.join(ids)})
      GROUP BY discount_id`,
  ]);
  for (const r of red) {
    const s = out.get(Number(r.discountId));
    if (!s) continue;
    s.used = Number(r.used);
    s.totalDiscounted = fromCents(r.amount);
    s.revenue = fromCents(r.revenue);
  }
  for (const r of codes) {
    const s = out.get(Number(r.discountId));
    if (!s) continue;
    s.codesTotal = Number(r.total);
    s.codesUsed = Number(r.used);
  }
  return out;
}

// ─── Target names (for summaries and default labels) ───────────────────────

export interface TargetNames {
  products: Map<string, string>;
  categories: Map<string, string>;
  departments: Map<string, string>;
}

export type Targets = Pick<State, 'productIds' | 'categoryIds' | 'departmentIds'>;

export const noNames = (): TargetNames => ({products: new Map(), categories: new Map(), departments: new Map()});

export async function loadTargetNames(db: Db, rows: Targets[]): Promise<TargetNames> {
  const p = new Set<string>();
  const c = new Set<string>();
  const d = new Set<string>();
  for (const r of rows) {
    r.productIds.forEach(x => p.add(x));
    r.categoryIds.forEach(x => c.add(x));
    r.departmentIds.forEach(x => d.add(x));
  }
  const cats = intIds([...c]);
  const depts = intIds([...d]);
  const sel = {select: {id: true, name: true}} as const;
  const [products, categories, departments] = await Promise.all([
    p.size ? db.product.findMany({where: {id: {in: [...p]}}, ...sel}) : [],
    cats.length ? db.category.findMany({where: {id: {in: cats}}, ...sel}) : [],
    depts.length ? db.department.findMany({where: {id: {in: depts}}, ...sel}) : [],
  ]);
  return {
    products: new Map(products.map(x => [String(x.id), x.name])),
    categories: new Map(categories.map(x => [String(x.id), x.name])),
    departments: new Map(departments.map(x => [String(x.id), x.name])),
  };
}

// ─── Derived fields ─────────────────────────────────────────────────────────

/** What the derived fields read (a `State`, or a serialized discount). */
export type Rule = Pick<
  State,
  | 'method'
  | 'code'
  | 'codeType'
  | 'kind'
  | 'value'
  | 'maxAmount'
  | 'buyQty'
  | 'getQty'
  | 'getPercent'
  | 'scope'
  | 'productIds'
  | 'categoryIds'
  | 'departmentIds'
  | 'minimum'
  | 'minimumQty'
  | 'eligibility'
  | 'customerIds'
  | 'usageLimit'
  | 'perCustomerLimit'
  | 'combinable'
  | 'active'
  | 'startsAt'
  | 'endsAt'
>;

const shortDate = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

export function discountStatus(
  d: Pick<Rule, 'active' | 'startsAt' | 'endsAt' | 'usageLimit' | 'method' | 'codeType'>,
  s: Pick<DiscountStats, 'used' | 'codesTotal' | 'codesUsed'>,
  now = new Date()
): DiscountStatus {
  if (!d.active) return 'inactive';
  if (d.startsAt && d.startsAt > now) return 'scheduled';
  if (d.endsAt && d.endsAt <= now) return 'expired';
  if (d.usageLimit != null && s.used >= d.usageLimit) return 'used_up';
  if (d.method === 'code' && d.codeType === 'unique' && s.codesTotal > 0 && s.codesUsed >= s.codesTotal) return 'used_up';
  return 'active';
}

/** "Knitwear", "Knitwear and Coats", "Knitwear, Coats and 2 more" (names de-duplicated). */
function targetText(d: Rule, names: TargetNames): string {
  const [ids, map] =
    d.scope === 'products'
      ? [d.productIds, names.products]
      : d.scope === 'categories'
        ? [d.categoryIds, names.categories]
        : d.scope === 'departments'
          ? [d.departmentIds, names.departments]
          : [[], names.products];
  const list = [...new Set(ids.map(id => map.get(id) ?? id))];
  if (!list.length) return '';
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} more`;
}

/** The offer itself: "15% off Knitwear", "15% off up to $40", "$25 off", "Free shipping on Shoes", "Buy 2 T-Shirts, get 1 free". */
export function ruleText(d: Rule, names: TargetNames, withTargets = true, currency = getStoreCurrency()): string {
  const t = withTargets ? targetText(d, names) : '';
  const value = num(d.value);
  switch (d.kind) {
    case 'percent': {
      const cap = d.maxAmount != null ? ` up to ${money(num(d.maxAmount), currency)}` : '';
      return `${pct(value)} off${t ? ` ${t}` : ''}${cap}`;
    }
    case 'fixed':
      return `${money(value, currency)} off${t ? ` ${t}` : ''}`;
    case 'shipping':
      return `Free shipping${t ? ` on ${t}` : ''}`;
    case 'bxgy': {
      const gp = d.getPercent ?? 100;
      const get = gp >= 100 ? 'free' : `at ${pct(gp)} off`;
      return `Buy ${d.buyQty ?? 1}${t ? ` ${t}` : ''}, get ${d.getQty ?? 1} ${get}`;
    }
  }
}

/** Customer-facing label: the offer, shortened when target names make it too long. */
export function defaultLabel(d: Rule, names: TargetNames, currency = getStoreCurrency()): string {
  const full = ruleText(d, names, true, currency);
  return full.length <= 60 ? full : ruleText(d, names, false, currency).slice(0, 60);
}

/** Customer-facing condition note. */
export function defaultNote(d: Pick<Rule, 'minimum' | 'minimumQty' | 'method'>, currency = getStoreCurrency()): string {
  const parts: string[] = [];
  const min = num(d.minimum);
  if (min > 0) parts.push(`Minimum spend ${money(min, currency)}`);
  if (d.minimumQty != null && d.minimumQty > 1) parts.push(`Minimum ${d.minimumQty} items`);
  if (parts.length) return parts.join(' · ');
  return d.method === 'automatic' ? 'Applied automatically' : 'Any order';
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Plain-language rule, e.g. "15% off Knitwear · automatic · not combinable · ends 20 Nov 2026". */
export function discountSummary(
  d: Rule,
  names: TargetNames,
  s: Pick<DiscountStats, 'codesTotal'>,
  now = new Date(),
  currency = getStoreCurrency()
): string {
  const parts = [ruleText(d, names, true, currency)];
  const min = num(d.minimum);
  if (min > 0) parts.push(`minimum spend ${money(min, currency)}`);
  if (d.minimumQty != null && d.minimumQty > 1) parts.push(`minimum ${d.minimumQty} items`);
  if (d.method === 'automatic') parts.push('automatic');
  else if (d.codeType === 'unique') parts.push(`${s.codesTotal} unique ${s.codesTotal === 1 ? 'code' : 'codes'}`);
  else if (d.code) parts.push(`code ${d.code}`);
  switch (d.eligibility) {
    case 'signed_in':
      parts.push('signed-in customers');
      break;
    case 'first_order':
      parts.push('first order only');
      break;
    case 'subscribers':
      parts.push('subscribers only');
      break;
    case 'customers':
      parts.push(`${d.customerIds.length} selected ${d.customerIds.length === 1 ? 'customer' : 'customers'}`);
      break;
  }
  if (d.perCustomerLimit != null) parts.push(`${times(d.perCustomerLimit)} per customer`);
  if (d.usageLimit != null) parts.push(`${d.usageLimit} ${d.usageLimit === 1 ? 'use' : 'uses'} in total`);
  if (d.method === 'automatic' && !d.combinable) parts.push('not combinable');
  if (d.startsAt && d.startsAt > now) parts.push(`starts ${shortDate.format(d.startsAt)}`);
  if (d.endsAt) parts.push(`${d.endsAt <= now ? 'ended' : 'ends'} ${shortDate.format(d.endsAt)}`);
  return parts.join(' · ');
}

// ─── Serializer ─────────────────────────────────────────────────────────────

export function adminDiscount(
  row: DiscountRow,
  stats: DiscountStats | undefined,
  names: TargetNames,
  currency = getStoreCurrency(),
  now = new Date()
): AdminDiscount {
  const s = stats ?? zeroStats();
  const d = stateOf(row);
  return {
    id: String(row.id),
    method: d.method,
    name: d.name,
    code: d.code,
    codeType: d.codeType,
    kind: d.kind,
    value: d.value,
    maxAmount: d.maxAmount,
    buyQty: d.buyQty,
    getQty: d.getQty,
    getPercent: d.getPercent,
    scope: d.scope,
    productIds: d.productIds,
    categoryIds: d.categoryIds,
    departmentIds: d.departmentIds,
    minimum: d.minimum,
    minimumQty: d.minimumQty,
    eligibility: d.eligibility,
    customerIds: d.customerIds,
    usageLimit: d.usageLimit,
    perCustomerLimit: d.perCustomerLimit,
    combinable: d.combinable,
    priority: d.priority,
    label: d.label,
    note: d.note,
    active: d.active,
    startsAt: d.startsAt ? d.startsAt.toISOString() : null,
    endsAt: d.endsAt ? d.endsAt.toISOString() : null,
    status: discountStatus(d, s, now),
    summary: discountSummary(d, names, s, now, currency),
    used: s.used,
    totalDiscounted: s.totalDiscounted,
    revenue: s.revenue,
    codesTotal: s.codesTotal,
    codesUsed: s.codesUsed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Serialize many rows: one stats query pair + one name lookup + the settings (currency), all in parallel. */
export async function serializeMany(db: Db, rows: DiscountRow[]): Promise<AdminDiscount[]> {
  const [stats, names, settings] = await Promise.all([
    loadStats(
      db,
      rows.map(r => r.id)
    ),
    loadTargetNames(db, rows.map(stateOf)),
    getSettings(db).catch(() => null),
  ]);
  const currency = settings?.currency ?? getStoreCurrency();
  const now = new Date();
  return rows.map(r => adminDiscount(r, stats.get(r.id), names, currency, now));
}

export async function serializeOne(db: Db, row: DiscountRow): Promise<AdminDiscount> {
  return (await serializeMany(db, [row]))[0]!;
}
