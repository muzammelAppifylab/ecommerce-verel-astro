/* Promotions admin: labels, the editor form model, client validation (mirrors the server's limits) and the
   client-side plain-language summary that mirrors the API's `summary` (port of VAREL
   src/pages/admin/discounts/helpers.ts; the search validators live in ../../queries/discounts.ts). */
import {money} from '../../../lib/format';
import type {
  AdminDiscount,
  AdminDiscountInput,
  DiscountCodeType,
  DiscountEligibility,
  DiscountKind,
  DiscountMethod,
  DiscountScope,
  DiscountStatus,
} from '../../../lib/types/admin/promotions';
import type {DiscountPreset} from '../../queries/discounts';
import type {Tone} from '../../ui';

export type {DiscountKind, DiscountStatus};

/* ── Labels ────────────────────────────────────────────────────────────── */

export const STATUSES: DiscountStatus[] = ['active', 'scheduled', 'expired', 'inactive', 'used_up'];

export const STATUS_LABEL: Record<DiscountStatus, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
  inactive: 'Inactive',
  used_up: 'Used up',
};

export const STATUS_TONES: Record<DiscountStatus, Tone> = {
  active: 'success',
  scheduled: 'warning',
  expired: 'neutral',
  inactive: 'neutral',
  used_up: 'danger',
};

export const KIND_LABEL: Record<DiscountKind, string> = {
  percent: 'Percentage',
  fixed: 'Fixed amount',
  shipping: 'Free shipping',
  bxgy: 'Buy X get Y',
};

export const SCOPE_LABEL: Record<DiscountScope, string> = {
  order: 'Entire order',
  products: 'Specific products',
  categories: 'Categories',
  departments: 'Departments',
};

export const ELIGIBILITY_LABEL: Record<DiscountEligibility, string> = {
  everyone: 'Everyone',
  signed_in: 'Signed-in customers',
  first_order: 'First order only',
  subscribers: 'Newsletter subscribers',
  customers: 'Specific customers',
};

export const ELIGIBILITY_DETAIL: Record<DiscountEligibility, string> = {
  everyone: 'Guests and signed-in customers.',
  signed_in: 'Customers with an account, signed in.',
  first_order: 'No previous paid order on the account or email.',
  subscribers: 'Customers on the newsletter list.',
  customers: 'Only the customers you choose.',
};

export const PRESET_INFO: Record<DiscountPreset, {title: string; detail: string}> = {
  order: {title: 'Amount off order', detail: 'A percentage or fixed amount off the whole bag.'},
  products: {title: 'Amount off products', detail: 'Off specific products, categories or departments.'},
  bxgy: {title: 'Buy X get Y', detail: 'Buy a number of items, get more free or at a discount.'},
  shipping: {title: 'Free shipping', detail: 'Remove the shipping charge, optionally for some items only.'},
};

export const nameOfDiscount = (d: Pick<AdminDiscount, 'name' | 'code'>) => d.name || d.code || 'Untitled discount';

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Status as the API derives it; used for the live editor badge before saving. */
export function deriveStatus(
  d: Pick<AdminDiscount, 'active' | 'startsAt' | 'endsAt' | 'usageLimit' | 'used' | 'method' | 'codeType'> &
    Partial<Pick<AdminDiscount, 'codesTotal' | 'codesUsed'>>,
  now = Date.now()
): DiscountStatus {
  if (!d.active) return 'inactive';
  if (d.startsAt && new Date(d.startsAt).getTime() > now) return 'scheduled';
  if (d.endsAt && new Date(d.endsAt).getTime() <= now) return 'expired';
  if (d.usageLimit != null && d.used >= d.usageLimit) return 'used_up';
  const total = d.codesTotal ?? 0;
  if (d.method === 'code' && d.codeType === 'unique' && total > 0 && (d.codesUsed ?? 0) >= total) return 'used_up';
  return 'active';
}

/** Name column: the code, "Automatic", or the unique-code count. */
export function codeText(d: Pick<AdminDiscount, 'method' | 'codeType' | 'code' | 'codesTotal'>): string {
  if (d.method === 'automatic') return 'Automatic';
  if (d.codeType === 'unique') return `${d.codesTotal} unique ${d.codesTotal === 1 ? 'code' : 'codes'}`;
  return d.code ?? '';
}

/* ── Form model ────────────────────────────────────────────────────────── */

/** Editor state: numbers stay strings while typing; dates are ISO or null (null start = now). */
export interface PromoForm {
  method: DiscountMethod;
  name: string;
  code: string;
  codeType: DiscountCodeType;
  kind: DiscountKind;
  value: string;
  maxAmount: string;
  buyQty: string;
  getQty: string;
  getPercent: string;
  scope: DiscountScope;
  productIds: string[];
  categoryIds: string[];
  departmentIds: string[];
  minimum: string;
  minimumQty: string;
  eligibility: DiscountEligibility;
  customerIds: string[];
  usageLimit: string;
  perCustomerLimit: string;
  combinable: boolean;
  priority: string;
  label: string;
  note: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export function formFromDiscount(d: AdminDiscountInput): PromoForm {
  return {
    method: d.method,
    name: d.name ?? '',
    code: d.code ?? '',
    codeType: d.codeType,
    kind: d.kind,
    value: d.kind === 'shipping' || d.kind === 'bxgy' ? '' : str(d.value),
    maxAmount: str(d.maxAmount),
    buyQty: str(d.buyQty),
    getQty: str(d.getQty),
    getPercent: str(d.getPercent),
    scope: d.scope,
    productIds: d.productIds ?? [],
    categoryIds: d.categoryIds ?? [],
    departmentIds: d.departmentIds ?? [],
    minimum: d.minimum ? String(d.minimum) : '',
    minimumQty: str(d.minimumQty),
    eligibility: d.eligibility,
    customerIds: d.customerIds ?? [],
    usageLimit: str(d.usageLimit),
    perCustomerLimit: str(d.perCustomerLimit),
    combinable: d.combinable,
    priority: String(d.priority ?? 0),
    label: d.label ?? '',
    note: d.note ?? '',
    active: d.active,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
  };
}

export function presetForm(preset: DiscountPreset = 'order'): PromoForm {
  const base: PromoForm = {
    method: 'code',
    name: '',
    code: '',
    codeType: 'shared',
    kind: 'percent',
    value: '10',
    maxAmount: '',
    buyQty: '',
    getQty: '',
    getPercent: '',
    scope: 'order',
    productIds: [],
    categoryIds: [],
    departmentIds: [],
    minimum: '',
    minimumQty: '',
    eligibility: 'everyone',
    customerIds: [],
    usageLimit: '',
    perCustomerLimit: '',
    combinable: false,
    priority: '0',
    label: '',
    note: '',
    active: true,
    startsAt: null,
    endsAt: null,
  };
  if (preset === 'products') return {...base, scope: 'products'};
  if (preset === 'bxgy') return {...base, kind: 'bxgy', value: '', buyQty: '2', getQty: '1', getPercent: '100', scope: 'categories'};
  if (preset === 'shipping') return {...base, kind: 'shipping', value: ''};
  return base;
}

/** Template for "Duplicate": same rules, new identity, inactive so it can be reviewed. */
export function duplicateForm(d: AdminDiscount): PromoForm {
  const f = formFromDiscount(d);
  return {
    ...f,
    name: d.name ? `${d.name} copy` : '',
    code: d.method === 'code' && d.codeType === 'shared' && d.code ? `${d.code}-COPY`.slice(0, 40) : '',
    active: false,
  };
}

export const snapshot = (f: PromoForm) => JSON.stringify(f);

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const num0 = (s: string) => (s.trim() === '' ? 0 : Number(s));

export function toInput(f: PromoForm): AdminDiscountInput {
  const isBxgy = f.kind === 'bxgy';
  return {
    method: f.method,
    name: f.name.trim(),
    code: f.method === 'code' && f.codeType === 'shared' ? f.code.trim().toUpperCase() : null,
    codeType: f.method === 'automatic' ? 'shared' : f.codeType,
    kind: f.kind,
    value: f.kind === 'percent' || f.kind === 'fixed' ? Number(f.value) : 0,
    maxAmount: f.kind === 'percent' ? numOrNull(f.maxAmount) : null,
    buyQty: isBxgy ? Number(f.buyQty) : null,
    getQty: isBxgy ? Number(f.getQty) : null,
    getPercent: isBxgy ? Number(f.getPercent) : null,
    scope: f.scope,
    productIds: f.scope === 'products' ? f.productIds : [],
    categoryIds: f.scope === 'categories' ? f.categoryIds : [],
    departmentIds: f.scope === 'departments' ? f.departmentIds : [],
    minimum: num0(f.minimum),
    minimumQty: numOrNull(f.minimumQty),
    eligibility: f.eligibility,
    customerIds: f.eligibility === 'customers' ? f.customerIds : [],
    usageLimit: numOrNull(f.usageLimit),
    perCustomerLimit: numOrNull(f.perCustomerLimit),
    combinable: f.combinable,
    priority: num0(f.priority),
    label: f.label.trim(),
    note: f.note.trim(),
    active: f.active,
    startsAt: f.startsAt,
    endsAt: f.endsAt,
  };
}

/* ── Validation (mirrors src/server/routes/admin/discounts.ts; may be stricter, never laxer) ─────── */

export type FieldErrors = Record<string, string>;

const isNum = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));
const isInt = (s: string) => isNum(s) && Number.isInteger(Number(s));

/** The same limits as the server's input schema, so a valid form is never refused for a range. */
export const LIMITS = {
  name: 80,
  code: 40,
  label: 60,
  note: 200,
  value: 100_000,
  money: 1_000_000,
  qty: 1000,
  minimumQty: 10_000,
  usageLimit: 10_000_000,
  perCustomerLimit: 10_000,
  priority: 1000,
  ids: 500,
} as const;

export function validate(f: PromoForm): FieldErrors {
  const out: FieldErrors = {};
  const bad = (path: string, message: string) => {
    if (!out[path]) out[path] = message;
  };
  if (f.method === 'automatic' && !f.name.trim()) bad('name', 'Automatic discounts need a name. Customers see it in the bag.');
  if (f.name.trim().length > LIMITS.name) bad('name', 'Keep the name under 80 characters.');
  if (f.method === 'code' && f.codeType === 'shared' && !/^[A-Z0-9_-]{2,40}$/.test(f.code.trim().toUpperCase()))
    bad('code', 'Use 2–40 letters, numbers, dashes or underscores.');
  if (f.kind === 'percent') {
    if (!isNum(f.value) || Number(f.value) < 1 || Number(f.value) > 100) bad('value', 'Enter a percentage between 1 and 100.');
    if (f.maxAmount.trim() && (!isNum(f.maxAmount) || Number(f.maxAmount) <= 0)) bad('maxAmount', 'Enter an amount above zero, or leave empty.');
    else if (f.maxAmount.trim() && Number(f.maxAmount) > LIMITS.money) bad('maxAmount', 'Use 1,000,000 or less.');
  }
  if (f.kind === 'fixed') {
    if (!isNum(f.value) || Number(f.value) <= 0) bad('value', 'Enter an amount above zero.');
    else if (Number(f.value) > LIMITS.value) bad('value', 'Use 100,000 or less.');
  }
  if (f.kind === 'bxgy') {
    if (!isInt(f.buyQty) || Number(f.buyQty) < 1) bad('buyQty', 'At least 1.');
    else if (Number(f.buyQty) > LIMITS.qty) bad('buyQty', 'Use 1,000 or less.');
    if (!isInt(f.getQty) || Number(f.getQty) < 1) bad('getQty', 'At least 1.');
    else if (Number(f.getQty) > LIMITS.qty) bad('getQty', 'Use 1,000 or less.');
    if (!isInt(f.getPercent) || Number(f.getPercent) < 1 || Number(f.getPercent) > 100) bad('getPercent', 'A whole number from 1 to 100. 100 is free.');
  }
  if (f.scope === 'products' && !f.productIds.length) bad('productIds', 'Choose at least one product.');
  if (f.scope === 'categories' && !f.categoryIds.length) bad('categoryIds', 'Choose at least one category.');
  if (f.scope === 'departments' && !f.departmentIds.length) bad('departmentIds', 'Choose at least one department.');
  for (const key of ['productIds', 'categoryIds', 'departmentIds', 'customerIds'] as const)
    if (f[key].length > LIMITS.ids) bad(key, 'Choose up to 500.');
  if (f.minimum.trim() && (!isNum(f.minimum) || Number(f.minimum) < 0)) bad('minimum', 'Enter zero or more.');
  else if (f.minimum.trim() && Number(f.minimum) > LIMITS.money) bad('minimum', 'Use 1,000,000 or less.');
  if (f.minimumQty.trim() && (!isInt(f.minimumQty) || Number(f.minimumQty) < 1)) bad('minimumQty', 'Enter a whole number, or leave empty.');
  else if (f.minimumQty.trim() && Number(f.minimumQty) > LIMITS.minimumQty) bad('minimumQty', 'Use 10,000 or less.');
  if (f.eligibility === 'customers' && !f.customerIds.length) bad('customerIds', 'Choose at least one customer.');
  if (f.usageLimit.trim() && (!isInt(f.usageLimit) || Number(f.usageLimit) < 1)) bad('usageLimit', 'Enter a whole number, or leave empty for no limit.');
  else if (f.usageLimit.trim() && Number(f.usageLimit) > LIMITS.usageLimit) bad('usageLimit', 'Use 10,000,000 or less.');
  if (f.perCustomerLimit.trim() && (!isInt(f.perCustomerLimit) || Number(f.perCustomerLimit) < 1))
    bad('perCustomerLimit', 'Enter a whole number, or leave empty for no limit.');
  else if (f.perCustomerLimit.trim() && Number(f.perCustomerLimit) > LIMITS.perCustomerLimit) bad('perCustomerLimit', 'Use 10,000 or less.');
  if (!isInt(f.priority) || Number(f.priority) < -LIMITS.priority || Number(f.priority) > LIMITS.priority)
    bad('priority', 'A whole number from -1000 to 1000.');
  if (!f.label.trim()) bad('label', 'Add a short label for the bag and checkout.');
  if (f.label.trim().length > LIMITS.label) bad('label', 'Keep the label under 60 characters.');
  if (f.note.trim().length > LIMITS.note) bad('note', 'Keep the note under 200 characters.');
  if (f.startsAt && f.endsAt && new Date(f.endsAt) <= new Date(f.startsAt)) bad('endsAt', 'The end must be after the start.');
  return out;
}

/** Server paths may be nested (`productIds.2`, `bxgy.buyQty`); show them on the field that owns them. */
export function fieldOf(path: string): string {
  const parts = path.split('.');
  if (parts[0] === 'bxgy' && parts[1]) return parts[1];
  return parts[0]!;
}

/* ── Plain-language summary, label and note ───────────────────────────── */
/* Mirrors src/server/routes/admin/discount-shared.ts (ruleText, discountSummary, defaultLabel, defaultNote),
   so the live preview reads exactly like the saved `summary`. */

export type NameOf = (kind: 'product' | 'category' | 'department' | 'customer', id: string) => string | undefined;

/** Dates read in the admin's local time, like the date picker that set them. */
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
const utcShortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});

/** The saved `summary` with its dates (formatted in UTC by the server) shown in local time. */
export function localSummary(d: Pick<AdminDiscount, 'summary' | 'startsAt' | 'endsAt'>): string {
  let s = d.summary;
  for (const [word, iso] of [
    ['starts', d.startsAt],
    ['ends', d.endsAt],
    ['ended', d.endsAt],
  ] as const) {
    if (iso) s = s.replace(`${word} ${utcShortDate(iso)}`, `${word} ${shortDate(iso)}`);
  }
  return s;
}
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** "Knitwear", "Knitwear and Coats", "Knitwear, Coats and 2 more" (names de-duplicated). */
function targetText(f: PromoForm, nameOf: NameOf): string {
  const [ids, kind] =
    f.scope === 'products'
      ? [f.productIds, 'product' as const]
      : f.scope === 'categories'
        ? [f.categoryIds, 'category' as const]
        : f.scope === 'departments'
          ? [f.departmentIds, 'department' as const]
          : [[], 'product' as const];
  const names = ids.map(id => nameOf(kind, id));
  if (names.some(n => !n))
    return ids.length
      ? `${ids.length} ${kind === 'category' ? (ids.length === 1 ? 'category' : 'categories') : ids.length === 1 ? kind : `${kind}s`}`
      : '';
  const list = [...new Set(names as string[])];
  if (!list.length) return '';
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} more`;
}

/** The offer: "15% off Knitwear", "15% off up to $40", "$25 off", "Free shipping on Shoes", "Buy 2 T-Shirts, get 1 free". */
export function ruleText(f: PromoForm, nameOf: NameOf, withTargets = true): string {
  const t = withTargets ? targetText(f, nameOf) : '';
  const value = Number(f.value) || 0;
  switch (f.kind) {
    case 'percent': {
      const cap = f.maxAmount.trim() && Number(f.maxAmount) > 0 ? ` up to ${money(Number(f.maxAmount))}` : '';
      return `${pct(value)} off${t ? ` ${t}` : ''}${cap}`;
    }
    case 'fixed':
      return `${money(value)} off${t ? ` ${t}` : ''}`;
    case 'shipping':
      return `Free shipping${t ? ` on ${t}` : ''}`;
    case 'bxgy': {
      const gp = f.getPercent.trim() ? Number(f.getPercent) : 100;
      const get = gp >= 100 ? 'free' : `at ${pct(gp)} off`;
      return `Buy ${f.buyQty || 1}${t ? ` ${t}` : ''}, get ${f.getQty || 1} ${get}`;
    }
  }
}

/** `codesTotal`: for a saved unique-code discount, so the count reads like the API's summary. */
export function summarize(f: PromoForm, nameOf: NameOf, codesTotal?: number, now = Date.now()): string {
  const parts = [ruleText(f, nameOf)];
  const min = Number(f.minimum) || 0;
  if (min > 0) parts.push(`minimum spend ${money(min)}`);
  const minQty = Number(f.minimumQty) || 0;
  if (minQty > 1) parts.push(`minimum ${minQty} items`);
  if (f.method === 'automatic') parts.push('automatic');
  else if (f.codeType === 'unique') parts.push(codesTotal != null ? `${codesTotal} unique ${codesTotal === 1 ? 'code' : 'codes'}` : 'unique codes');
  else if (f.code.trim()) parts.push(`code ${f.code.trim().toUpperCase()}`);
  if (f.eligibility === 'signed_in') parts.push('signed-in customers');
  if (f.eligibility === 'first_order') parts.push('first order only');
  if (f.eligibility === 'subscribers') parts.push('subscribers only');
  if (f.eligibility === 'customers') parts.push(`${f.customerIds.length} selected ${f.customerIds.length === 1 ? 'customer' : 'customers'}`);
  if (f.perCustomerLimit.trim() && Number(f.perCustomerLimit) > 0) parts.push(`${times(Number(f.perCustomerLimit))} per customer`);
  if (f.usageLimit.trim() && Number(f.usageLimit) > 0) parts.push(`${f.usageLimit} ${Number(f.usageLimit) === 1 ? 'use' : 'uses'} in total`);
  if (f.method === 'automatic' && !f.combinable) parts.push('not combinable');
  if (f.startsAt && new Date(f.startsAt).getTime() > now) parts.push(`starts ${shortDate(f.startsAt)}`);
  if (f.endsAt) parts.push(`${new Date(f.endsAt).getTime() <= now ? 'ended' : 'ends'} ${shortDate(f.endsAt)}`);
  return parts.join(' · ');
}

export function suggestLabel(f: PromoForm, nameOf: NameOf): string {
  const full = ruleText(f, nameOf);
  return full.length <= 60 ? full : ruleText(f, nameOf, false).slice(0, 60);
}

export function suggestNote(f: PromoForm): string {
  const parts: string[] = [];
  const min = Number(f.minimum) || 0;
  if (min > 0) parts.push(`Minimum spend ${money(min)}`);
  const minQty = Number(f.minimumQty) || 0;
  if (minQty > 1) parts.push(`Minimum ${minQty} items`);
  if (parts.length) return parts.join(' · ');
  return f.method === 'automatic' ? 'Applied automatically' : 'Any order';
}

/** A worked example for the bag preview: amount saved on a sample bag. */
export function sampleSaving(f: PromoForm): {subtotal: number; amount: number | null; text: string} {
  const min = Number(f.minimum) || 0;
  if (f.kind === 'bxgy') {
    const buy = Math.max(1, Number(f.buyQty) || 1);
    const get = Math.max(1, Number(f.getQty) || 1);
    const unit = 60;
    const amount = Math.round(get * unit * (Math.min(100, Number(f.getPercent) || 0) / 100) * 100) / 100;
    return {subtotal: (buy + get) * unit, amount, text: `${buy + get} items at ${money(unit)}`};
  }
  const subtotal = Math.max(150, Math.ceil(min / 10) * 10 + (min ? 20 : 0));
  if (f.kind === 'shipping') return {subtotal, amount: null, text: `A ${money(subtotal)} bag`};
  const v = Number(f.value) || 0;
  let amount = f.kind === 'percent' ? (subtotal * v) / 100 : Math.min(v, subtotal);
  if (f.kind === 'percent' && Number(f.maxAmount) > 0) amount = Math.min(amount, Number(f.maxAmount));
  return {subtotal, amount: Math.round(amount * 100) / 100, text: `A ${money(subtotal)} bag${f.scope === 'order' ? '' : ' of qualifying items'}`};
}

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Random shared code: A–Z and 2–9 without look-alikes, like the API's unique codes. */
export function randomCode(length = 8): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** ISO → "12 Nov 2026, 09:00" for the date-time picker's trigger. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
}

/** "12 Nov 2026, 09:00", or "—" (VAREL `formatDateTime`). */
export const formatDateTime = (iso: string | null | undefined) => (iso ? formatWhen(iso) : '—');
