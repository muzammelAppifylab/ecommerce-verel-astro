/* Product editor model: form state ↔ AdminProduct / AdminProductInput, validation, SKU helpers.
   Port of VAREL `src/pages/admin/products/form.ts`. The variant row type and its SKU / price helpers live in
   WP-18's `./variants` (no form ↔ variants import cycle); they are re-exported here so the editor has one model.
   Client limits mirror the server's (src/server/routes/admin/products.ts, AGENTS.md "client rules mirror the server"). */
import {z} from 'zod';

import {slugify} from '../../../lib/format';
import type {AdminProduct, AdminProductInput, DimensionUnit, ProductStatus, ProductType, WeightUnit} from '../../../lib/types/admin/catalog';
import type {ImageItem} from '../../ui';
import {effectivePrice, effectiveSku, type OptionDef, optionsFrom, toProductOptions, uid, type VariantItem, variantSku} from './variants';

export {effectivePrice, effectiveSku, uid, variantSku};
export type {ImageItem, OptionDef, VariantItem};

/** SEO lengths search engines show; the counters warn above them, the hard limits are twice that (server 120 / 320). */
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;

/** Server limits (src/server/routes/admin/products.ts). */
export const LIMITS = {
  name: 160,
  brand: 80,
  short: 300,
  description: 10_000,
  material: 120,
  care: 2000,
  sku: 64,
  slug: 120,
  tags: 30,
  money: 1_000_000,
  measure: 100_000,
  download: 200,
} as const;

export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ProductForm {
  name: string;
  id: string; // slug
  brand: string;
  short: string;
  description: string;
  material: string;
  care: string;
  tags: string[];
  dept: string;
  category: string;
  type: ProductType;
  status: ProductStatus;
  download: string;
  price: string;
  compareAt: string;
  sku: string;
  images: ImageItem[];
  variants: VariantItem[];
  allowBackorder: boolean;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  costPerItem: string;
  weight: string;
  weightUnit: WeightUnit;
  packageLength: string;
  packageWidth: string;
  packageHeight: string;
  dimensionUnit: DimensionUnit;
  /** Variant options in order (colour, size, custom), up to 3 */
  options: OptionDef[];
}

/** The one variant of a product without options: no colour, no size, SKU from the base SKU. */
export const defaultVariant = (price = '', inventory = '0'): VariantItem => ({
  uid: uid(),
  id: '',
  color: null,
  size: null,
  swatch: null,
  options: {},
  price,
  inventory,
});

export function emptyForm(): ProductForm {
  return {
    name: '',
    id: '',
    brand: 'VAREL',
    short: '',
    description: '',
    material: '',
    care: '',
    tags: [],
    dept: '',
    category: '',
    type: 'physical',
    status: 'draft',
    download: '',
    price: '',
    compareAt: '',
    sku: '',
    images: [],
    variants: [defaultVariant()],
    allowBackorder: false,
    featured: false,
    seoTitle: '',
    seoDescription: '',
    costPerItem: '',
    weight: '',
    weightUnit: 'kg',
    packageLength: '',
    packageWidth: '',
    packageHeight: '',
    dimensionUnit: 'cm',
    options: [],
  };
}

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export function formFromProduct(p: AdminProduct): ProductForm {
  const variants: VariantItem[] = p.variants.map(v => ({
    uid: uid(),
    id: v.id,
    color: v.color,
    size: v.size,
    swatch: v.swatch,
    options: v.options ?? {},
    // A variant at the product price inherits it, so later price changes carry through.
    price: v.price === p.price ? '' : String(v.price),
    inventory: v.inventory === null ? '' : String(v.inventory),
  }));
  return {
    name: p.name,
    id: p.id,
    brand: p.brand,
    short: p.short,
    description: p.description,
    material: p.material,
    care: p.care ?? '',
    tags: p.tags,
    dept: p.dept,
    category: p.category,
    type: p.type,
    status: p.status,
    download: p.download ?? '',
    price: String(p.price),
    compareAt: p.compareAt === null ? '' : String(p.compareAt),
    sku: p.sku,
    images: [...p.images]
      .sort((a, b) => a.position - b.position)
      .map(i => ({uid: uid(), src: i.src, credit: i.credit, creditHref: i.creditHref, ...(i.fileId ? {fileId: i.fileId} : {})})),
    variants,
    allowBackorder: p.allowBackorder ?? false,
    featured: p.featured ?? false,
    seoTitle: p.seoTitle ?? '',
    seoDescription: p.seoDescription ?? '',
    costPerItem: str(p.costPerItem),
    weight: str(p.weight),
    weightUnit: p.weightUnit ?? 'kg',
    packageLength: str(p.packageLength),
    packageWidth: str(p.packageWidth),
    packageHeight: str(p.packageHeight),
    dimensionUnit: p.dimensionUnit ?? 'cm',
    options: p.type === 'digital' ? [] : optionsFrom(variants, p.options ?? []),
  };
}

/** Comparable snapshot for the unsaved-changes guard (ignores row uids, upload progress, previews and option ids). */
export function snapshot(f: ProductForm): string {
  return JSON.stringify({
    ...f,
    images: f.images.map(i => i.src),
    variants: f.variants.map(({uid: _u, ...v}) => v),
    options: f.options.map(({id: _i, ...o}) => o),
  });
}

/* ---------- SKU helpers ---------- */

const code = (s: string, n: number) =>
  s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, n);

/** "Linen Camp Shirt" → "VRL-LCS" */
export function baseSkuFromName(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const letters = words.length >= 3 ? words.slice(0, 3).map(w => w[0]) : [code(words.join(''), 3)];
  return `VRL-${letters.join('').toUpperCase()}`;
}

/** The slug a name gives (≤ 120 characters, no trailing dash). */
export function slugFromName(name: string): string {
  return slugify(name).slice(0, LIMITS.slug).replace(/-+$/, '');
}

/* ---------- Validation ---------- */

const isAmount = (v: string) => Number.isFinite(Number(v)) && Number(v) >= 0;

const money = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(isAmount, `${label} must be a positive amount`)
    .refine(v => !isAmount(v) || Number(v) <= LIMITS.money, `Keep ${label.toLowerCase()} under $1,000,000`);

/** Empty, or a number of zero or more (≤ 100,000 for sizes). */
const optionalAmount = (max: number) =>
  z
    .string()
    .trim()
    .refine(v => v === '' || isAmount(v), 'Enter zero or more')
    .refine(v => v === '' || !isAmount(v) || Number(v) <= max, 'Use a smaller number');

export const productSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(LIMITS.name, `Keep the name under ${LIMITS.name} characters`),
    id: z
      .string()
      .trim()
      .min(1, 'Enter a slug')
      .max(LIMITS.slug, `Keep the slug under ${LIMITS.slug} characters`)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens'),
    brand: z.string().trim().min(1, 'Brand is required').max(LIMITS.brand, `Keep the brand under ${LIMITS.brand} characters`),
    short: z.string().trim().max(LIMITS.short, `Keep the summary under ${LIMITS.short} characters`),
    description: z.string().trim().max(LIMITS.description, `Keep the description under ${LIMITS.description.toLocaleString('en')} characters`),
    material: z.string().trim().max(LIMITS.material, `Keep the material under ${LIMITS.material} characters`),
    care: z.string().trim().max(LIMITS.care, `Keep care under ${LIMITS.care} characters`),
    tags: z.array(z.string().max(40, 'Keep tags under 40 characters')).max(LIMITS.tags, `Use ${LIMITS.tags} tags or fewer`),
    dept: z.string().min(1, 'Choose a department'),
    category: z.string().min(1, 'Choose a category'),
    type: z.enum(['physical', 'digital']),
    status: z.enum(['draft', 'published', 'archived']),
    download: z
      .string()
      .trim()
      .max(LIMITS.download, `Keep the file name under ${LIMITS.download} characters`)
      .refine(v => v === '' || /^[\w.-]+$/.test(v), 'Use a file name such as varel-care-guide.pdf'),
    price: money('Price'),
    compareAt: z
      .string()
      .trim()
      .refine(v => v === '' || isAmount(v), 'Enter a positive amount')
      .refine(v => v === '' || !isAmount(v) || Number(v) <= LIMITS.money, 'Keep the compare-at price under $1,000,000'),
    sku: z
      .string()
      .trim()
      .min(1, 'SKU is required')
      .max(LIMITS.sku, `Keep the SKU under ${LIMITS.sku} characters`)
      .regex(SKU_RE, 'Use letters, numbers, dots, dashes and underscores'),
    images: z.array(z.object({src: z.string(), progress: z.number().optional()})).max(20, 'Use 20 images or fewer'),
    seoTitle: z.string().trim().max(SEO_TITLE_MAX * 2, `Keep the SEO title under ${SEO_TITLE_MAX * 2} characters`),
    seoDescription: z.string().trim().max(SEO_DESCRIPTION_MAX * 2, `Keep the SEO description under ${SEO_DESCRIPTION_MAX * 2} characters`),
    costPerItem: optionalAmount(LIMITS.money),
    weight: optionalAmount(LIMITS.measure),
    packageLength: optionalAmount(LIMITS.measure),
    packageWidth: optionalAmount(LIMITS.measure),
    packageHeight: optionalAmount(LIMITS.measure),
    variants: z
      .array(
        z.object({
          id: z
            .string()
            .trim()
            .max(LIMITS.sku, `Keep the SKU under ${LIMITS.sku} characters`)
            .refine(v => v === '' || SKU_RE.test(v), 'Use letters, numbers, dots, dashes and underscores'),
          price: z
            .string()
            .trim()
            .refine(v => v === '' || isAmount(v), 'Price must be a positive amount')
            .refine(v => v === '' || !isAmount(v) || Number(v) <= LIMITS.money, 'Keep the price under $1,000,000'),
          inventory: z.string().trim(),
          color: z.string().nullable(),
          size: z.string().nullable(),
          options: z.record(z.string(), z.string()),
        })
      )
      .max(200, 'Use 200 variants or fewer'),
  })
  .superRefine((f, ctx) => {
    if (f.compareAt !== '' && Number(f.compareAt) <= Number(f.price))
      ctx.addIssue({code: 'custom', path: ['compareAt'], message: 'Compare-at must be higher than the price'});
    if (f.type === 'digital' && !f.download.trim()) ctx.addIssue({code: 'custom', path: ['download'], message: 'Add the download filename'});
    if (f.images.some(i => i.progress !== undefined)) ctx.addIssue({code: 'custom', path: ['images'], message: 'Wait for uploads to finish'});
    if (f.type === 'physical') {
      if (!f.variants.length) ctx.addIssue({code: 'custom', path: ['variants'], message: 'Add at least one variant'});
      const seen = new Map<string, number>();
      f.variants.forEach((v, i) => {
        const inv = v.inventory;
        if (inv === '' || !Number.isInteger(Number(inv)) || Number(inv) < 0)
          ctx.addIssue({code: 'custom', path: ['variants', i, 'inventory'], message: 'Whole number, 0 or more'});
        else if (Number(inv) > 1_000_000) ctx.addIssue({code: 'custom', path: ['variants', i, 'inventory'], message: 'Use a smaller number'});
        const key = effectiveSku(v, f.sku.trim()).toUpperCase();
        if (key && seen.has(key)) ctx.addIssue({code: 'custom', path: ['variants', i, 'id'], message: 'Duplicate SKU'});
        else seen.set(key, i);
      });
    }
  });

export type FieldErrors = Record<string, string>;

export function validate(f: ProductForm): FieldErrors {
  const res = productSchema.safeParse(f);
  if (res.success) return {};
  const out: FieldErrors = {};
  for (const issue of res.error.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

/* ---------- Form → API input ---------- */

const amountOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function toInput(f: ProductForm, opts: {includeId: boolean}): AdminProductInput {
  const price = Number(f.price);
  const sku = f.sku.trim().toUpperCase();
  const physical = f.type === 'physical';
  const variants: AdminProductInput['variants'] = physical
    ? f.variants.map(v => ({
        id: effectiveSku(v, sku).toUpperCase(),
        color: v.color || null,
        size: v.size || null,
        swatch: v.swatch || null,
        options: v.options ?? {},
        price: Number(effectivePrice(v, f.price)),
        inventory: Math.max(0, Math.floor(Number(v.inventory) || 0)),
      }))
    : [{id: (f.variants[0]?.id.trim() || sku).toUpperCase(), color: null, size: null, swatch: null, price, inventory: null}];
  return {
    ...(opts.includeId ? {id: f.id.trim()} : {}),
    name: f.name.trim(),
    brand: f.brand.trim(),
    dept: f.dept,
    category: f.category,
    type: f.type,
    status: f.status,
    price,
    compareAt: f.compareAt.trim() === '' ? null : Number(f.compareAt),
    sku,
    short: f.short.trim(),
    description: f.description.trim(),
    material: f.material.trim(),
    care: f.care.trim() || null,
    tags: f.tags,
    download: physical ? null : f.download.trim() || null,
    images: f.images.map(i => ({src: i.src, credit: i.credit, creditHref: i.creditHref, fileId: i.fileId ?? null})),
    variants,
    allowBackorder: physical && f.allowBackorder,
    featured: f.featured,
    seoTitle: f.seoTitle.trim() || null,
    seoDescription: f.seoDescription.trim() || null,
    costPerItem: amountOrNull(f.costPerItem),
    weight: physical ? amountOrNull(f.weight) : null,
    weightUnit: f.weightUnit,
    packageLength: physical ? amountOrNull(f.packageLength) : null,
    packageWidth: physical ? amountOrNull(f.packageWidth) : null,
    packageHeight: physical ? amountOrNull(f.packageHeight) : null,
    dimensionUnit: f.dimensionUnit,
    options: physical ? toProductOptions(f.options) : [],
  };
}

/* ---------- Profit ---------- */

/** Profit and margin per unit at a price, or null without both numbers. */
export function profitOf(price: string, cost: string): {profit: number; margin: number} | null {
  const p = Number(price);
  const c = Number(cost);
  if (price.trim() === '' || cost.trim() === '' || !Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
  return {profit: p - c, margin: ((p - c) / p) * 100};
}

/** Value at a dotted path such as `variants.2.price` (JSON-encoded for comparison). */
export function valueAt(form: ProductForm, path: string): string {
  let cur: unknown = form;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[key];
  }
  return JSON.stringify(cur ?? null);
}
