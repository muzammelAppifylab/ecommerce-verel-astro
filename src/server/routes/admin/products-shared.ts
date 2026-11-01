/* Products admin helpers (port of VAREL worker/routes/admin/products.ts helpers and
   worker/routes/admin/serializers.ts `adminProductRow` / `adminProduct`). Used by ./products.ts only.
   Money is integer cents in the database and major units on the wire (F1/F3). */
import {Prisma} from '../../../generated/prisma/client';
import type {
  AdminProduct,
  AdminProductRow,
  DimensionUnit,
  ProductStatus,
  ProductType,
  StockState,
  WeightUnit,
} from '../../../lib/types/admin/catalog';
import type {Db} from '../../lib/db';
import {conflict, HttpError, invalid, notFound} from '../../lib/errors';
import {slugify} from '../../lib/format';
import {fromCents, fromCentsOrNull, numOrNull} from '../../lib/money';
import {stockOf} from '../../lib/serializers';
import {optionDefs, optionValues} from '../../lib/variant-options';

// ─── Select and serializers ─────────────────────────────────────────────────

/** Most images and variants a product carries (the editor's limits: 20 and 200). */
export const MAX_IMAGES = 20;
export const MAX_VARIANTS = 200;

/** Every column the admin product answer reads (explicit select, docs/agent/performance.md). */
export const adminProductSelect = {
  id: true,
  name: true,
  brand: true,
  type: true,
  status: true,
  priceCents: true,
  compareAtCents: true,
  sku: true,
  short: true,
  description: true,
  material: true,
  care: true,
  tags: true,
  download: true,
  position: true,
  categoryPosition: true,
  featured: true,
  allowBackorder: true,
  costCents: true,
  weight: true,
  weightUnit: true,
  packageLength: true,
  packageWidth: true,
  packageHeight: true,
  dimensionUnit: true,
  options: true,
  seoTitle: true,
  seoDescription: true,
  departmentId: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  department: {select: {name: true}},
  category: {select: {name: true}},
  images: {
    orderBy: [{position: 'asc'}, {id: 'asc'}],
    take: MAX_IMAGES,
    select: {id: true, key: true, src: true, credit: true, creditHref: true, position: true},
  },
  variants: {
    orderBy: [{position: 'asc'}, {id: 'asc'}],
    take: MAX_VARIANTS,
    select: {
      id: true,
      color: true,
      size: true,
      swatch: true,
      options: true,
      priceCents: true,
      inventory: true,
      position: true,
    },
  },
} satisfies Prisma.ProductSelect;

export type AdminProductRecord = Prisma.ProductGetPayload<{select: typeof adminProductSelect}>;

/** A platform file id (`file_` + 26 base-36 characters). */
export const FILE_ID_RE = /^file_[0-9a-z]{26}$/;
/** A public platform file link on this site: `/__platform/files/<fileId>/<name>`. */
const PLATFORM_LINK_RE = /^\/__platform\/files\/(file_[0-9a-z]{26})\/[^/?#\s]+$/;

/**
 * What an image `src` is: an `https://` URL (seed images, pasted links), an uploaded platform file
 * (its id), or neither (`null`: refused). Replaces VAREL's `/api/media/<key>` links (D8).
 */
export function parseImageSrc(src: string): {kind: 'https'} | {kind: 'file'; fileId: string} | null {
  const s = src.trim();
  if (/^https:\/\/[^\s]+$/i.test(s)) return {kind: 'https'};
  const m = PLATFORM_LINK_RE.exec(s);
  return m ? {kind: 'file', fileId: m[1] as string} : null;
}

/** Orders containing a product are counted up to this (101 reads as "100+"). */
export const ORDER_COUNT_CAP = 101;

/** Distinct orders that contain the product, bounded (never a full count over a growing table). */
export async function orderCountOf(db: Db, productId: string): Promise<number> {
  const rows = await db.$queryRaw<{n: number}[]>`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT order_id FROM shop_order_items WHERE product_id = ${productId} LIMIT ${ORDER_COUNT_CAP}
    ) s`;
  return rows[0]?.n ?? 0;
}

export function adminProduct(p: AdminProductRecord, orderCount: number, lowStock: number): AdminProduct {
  const digital = p.type === 'digital';
  const first = p.images[0];
  return {
    id: p.id,
    name: p.name,
    dept: p.department.name,
    category: p.category.name,
    type: p.type as ProductType,
    status: p.status as ProductStatus,
    price: fromCents(p.priceCents),
    compareAt: fromCentsOrNull(p.compareAtCents),
    sku: p.sku,
    image: first ? {src: first.src, credit: first.credit, creditHref: first.creditHref} : null,
    variantCount: p.variants.length,
    inventory: digital ? null : p.variants.reduce((n, v) => n + Math.max(0, v.inventory ?? 0), 0),
    stock: stockOf(p, lowStock),
    updatedAt: p.updatedAt.toISOString(),
    brand: p.brand,
    short: p.short,
    description: p.description,
    material: p.material,
    care: p.care,
    tags: p.tags,
    download: p.download,
    images: p.images.map(i => ({
      id: String(i.id),
      src: i.src,
      credit: i.credit || null,
      creditHref: i.creditHref || null,
      position: i.position,
      fileId: FILE_ID_RE.test(i.key) ? i.key : null,
    })),
    variants: p.variants.map(v => ({
      id: v.id,
      color: v.color,
      size: v.size,
      swatch: v.swatch,
      options: optionValues(v.options),
      price: fromCents(v.priceCents),
      inventory: v.inventory,
    })),
    createdAt: p.createdAt.toISOString(),
    orderCount,
    allowBackorder: p.allowBackorder,
    featured: p.featured,
    categoryPosition: p.categoryPosition,
    seoTitle: p.seoTitle ?? null,
    seoDescription: p.seoDescription ?? null,
    costPerItem: fromCentsOrNull(p.costCents),
    weight: numOrNull(p.weight),
    weightUnit: p.weightUnit as WeightUnit,
    packageLength: numOrNull(p.packageLength),
    packageWidth: numOrNull(p.packageWidth),
    packageHeight: numOrNull(p.packageHeight),
    dimensionUnit: p.dimensionUnit as DimensionUnit,
    options: optionDefs(p.options),
  };
}

/** One row of the list query (`listProducts`), snake_case as Postgres answers it. */
export interface ListRow {
  id: string;
  name: string;
  sku: string;
  type: string;
  status: string;
  price_cents: number;
  compare_at_cents: number | null;
  updated_at: Date;
  created_at: Date;
  position: number;
  dept: string;
  category: string;
  variant_count: number;
  inventory: number | null;
  stock: StockState;
  stock_rank: number;
  src: string | null;
  credit: string | null;
  credit_href: string | null;
}

export function adminProductRow(r: ListRow): AdminProductRow {
  return {
    id: r.id,
    name: r.name,
    dept: r.dept,
    category: r.category,
    type: r.type as ProductType,
    status: r.status as ProductStatus,
    price: fromCents(r.price_cents),
    compareAt: fromCentsOrNull(r.compare_at_cents),
    sku: r.sku,
    image: r.src ? {src: r.src, credit: r.credit ?? '', creditHref: r.credit_href ?? ''} : null,
    variantCount: r.variant_count,
    inventory: r.type === 'digital' ? null : r.inventory,
    stock: r.stock,
    updatedAt: r.updated_at.toISOString(),
  };
}

// ─── The list query (keyset) ────────────────────────────────────────────────

export const STOCK_STATES = ['in', 'low', 'out', 'digital'] as const;
export const PRODUCT_SORT_FIELDS = ['name', 'sku', 'price', 'status', 'inventory', 'stock', 'updatedAt', 'createdAt', 'position'] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

/** `%`, `_` and `\` matched literally inside an ILIKE pattern. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

/** The search words used: split on whitespace, at most 8. */
export const searchWords = (q: string) => q.split(/\s+/).filter(Boolean).slice(0, 8);

export interface ListFilters {
  q: string;
  status: string[];
  dept?: string;
  category?: string;
  stock: string[];
}

/** The sort expression of a field, over the inner query's columns (`t.*`). */
const SORT_EXPR: Record<Exclude<ProductSortField, 'inventory'>, Prisma.Sql> = {
  name: Prisma.sql`lower(t.name)`,
  sku: Prisma.sql`t.sku`,
  price: Prisma.sql`t.price_cents`,
  status: Prisma.sql`t.status`,
  stock: Prisma.sql`t.stock_rank`,
  updatedAt: Prisma.sql`t.updated_at`,
  createdAt: Prisma.sql`t.created_at`,
  position: Prisma.sql`t.position`,
};

/** The cursor values of a row for a sort (VAREL `compareBy` order: digital inventory last both ways). */
export function cursorOf(field: ProductSortField, r: ListRow): (string | number | Date)[] {
  switch (field) {
    case 'name':
      return [r.name.toLowerCase(), r.id];
    case 'sku':
      return [r.sku, r.id];
    case 'price':
      return [r.price_cents, r.id];
    case 'status':
      return [r.status, r.id];
    case 'stock':
      return [r.stock_rank, r.id];
    case 'updatedAt':
      return [r.updated_at, r.id];
    case 'createdAt':
      return [r.created_at, r.id];
    case 'position':
      return [r.position, r.id];
    case 'inventory':
      return [r.inventory === null ? 1 : 0, r.inventory ?? 0, r.id];
  }
}

export const cursorArity = (field: ProductSortField) => (field === 'inventory' ? 3 : 2);

type CursorValues = (string | number | boolean | null)[];

/** The keyset predicate for rows after the cursor, or `null` when the cursor does not fit the sort. */
function keyset(field: ProductSortField, dir: 'asc' | 'desc', after: CursorValues | null): Prisma.Sql | null {
  if (!after) return null;
  const op = dir === 'desc' ? Prisma.raw('<') : Prisma.raw('>');
  if (field === 'inventory') {
    const [isNull, inv, id] = after;
    if ((isNull !== 0 && isNull !== 1) || typeof inv !== 'number' || !Number.isInteger(inv) || typeof id !== 'string') return null;
    return Prisma.sql`((CASE WHEN t.inventory IS NULL THEN 1 ELSE 0 END) > ${isNull}
      OR ((CASE WHEN t.inventory IS NULL THEN 1 ELSE 0 END) = ${isNull} AND (COALESCE(t.inventory, 0), t.id) ${op} (${inv}::int, ${id}::text)))`;
  }
  const [value, id] = after;
  if (typeof id !== 'string') return null;
  if (field === 'updatedAt' || field === 'createdAt') {
    const date = typeof value === 'string' ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    return Prisma.sql`(${SORT_EXPR[field]}, t.id) ${op} (${date}::timestamptz, ${id}::text)`;
  }
  if (field === 'price' || field === 'stock' || field === 'position') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    return Prisma.sql`(${SORT_EXPR[field]}, t.id) ${op} (${value}::int, ${id}::text)`;
  }
  if (typeof value !== 'string') return null;
  return Prisma.sql`(${SORT_EXPR[field]}, t.id) ${op} (${value}::text, ${id}::text)`;
}

function orderBy(field: ProductSortField, dir: 'asc' | 'desc'): Prisma.Sql {
  const d = Prisma.raw(dir === 'desc' ? 'DESC' : 'ASC');
  if (field === 'inventory') return Prisma.sql`(t.inventory IS NULL) ASC, COALESCE(t.inventory, 0) ${d}, t.id ${d}`;
  return Prisma.sql`${SORT_EXPR[field]} ${d}, t.id ${d}`;
}

/**
 * One page of the admin product list: filters, computed stock (VAREL `stockOf`: negative stock
 * counts as 0, backorder with no stock reads "in"), keyset order. `size + 1` rows are read so the
 * caller knows whether there is a next page. One tagged statement, never `$queryRawUnsafe`.
 */
export async function listProducts(
  db: Db,
  f: ListFilters,
  sort: {field: ProductSortField; dir: 'asc' | 'desc'},
  after: CursorValues | null,
  size: number
): Promise<ListRow[]> {
  const where: Prisma.Sql[] = [];
  if (f.status.length) where.push(Prisma.sql`p.status IN (${Prisma.join(f.status)})`);
  if (f.dept) where.push(Prisma.sql`(d.slug = ${slugify(f.dept)} OR lower(d.name) = lower(${f.dept}))`);
  if (f.category) where.push(Prisma.sql`(c.slug = ${slugify(f.category)} OR lower(c.name) = lower(${f.category}))`);
  for (const word of searchWords(f.q)) {
    const w = `%${likeEscape(word)}%`;
    where.push(
      Prisma.sql`(p.name ILIKE ${w} OR p.sku ILIKE ${w} OR p.brand ILIKE ${w} OR p.id ILIKE ${w}
        OR EXISTS (SELECT 1 FROM variants x WHERE x.product_id = p.id AND x.id ILIKE ${w}))`
    );
  }
  const outer: Prisma.Sql[] = [];
  if (f.stock.length) outer.push(Prisma.sql`t.stock IN (${Prisma.join(f.stock)})`);
  const after_ = keyset(sort.field, sort.dir, after);
  if (after_) outer.push(after_);
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
  const outerSql = outer.length ? Prisma.sql`WHERE ${Prisma.join(outer, ' AND ')}` : Prisma.empty;

  return db.$queryRaw<ListRow[]>`
    SELECT * FROM (
      SELECT s.*,
             CASE s.stock WHEN 'in' THEN 0 WHEN 'low' THEN 1 WHEN 'out' THEN 2 ELSE 3 END AS stock_rank
      FROM (
        SELECT p.id, p.name, p.sku, p.type, p.status, p.price_cents, p.compare_at_cents,
               p.updated_at, p.created_at, p.position, d.name AS dept, c.name AS category,
               v.n AS variant_count,
               CASE WHEN p.type = 'digital' THEN NULL ELSE v.inv END AS inventory,
               CASE WHEN p.type = 'digital' THEN 'digital'
                    WHEN v.inv = 0 THEN CASE WHEN p.allow_backorder THEN 'in' ELSE 'out' END
                    WHEN v.inv <= COALESCE((SELECT low_stock_threshold FROM settings WHERE id = 1), 6) THEN 'low'
                    ELSE 'in' END AS stock,
               img.src, img.credit, img.credit_href
        FROM products p
        JOIN departments d ON d.id = p.department_id
        JOIN categories c ON c.id = p.category_id
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS n, COALESCE(sum(GREATEST(COALESCE(inventory, 0), 0)), 0)::int AS inv
          FROM variants WHERE product_id = p.id
        ) v
        LEFT JOIN LATERAL (
          SELECT src, credit, credit_href FROM product_images
          WHERE product_id = p.id ORDER BY position, id LIMIT 1
        ) img ON true
        ${whereSql}
      ) s
    ) t
    ${outerSql}
    ORDER BY ${orderBy(sort.field, sort.dir)}
    LIMIT ${size + 1}`;
}

// ─── Taxonomy, SKUs, uploads ────────────────────────────────────────────────

/** Department and category by name or slug (VAREL `resolveTaxonomy`). 422 when either is unknown. */
export async function resolveTaxonomy(db: Db, dept: string, category: string) {
  const d = await db.department.findFirst({
    where: {OR: [{slug: slugify(dept)}, {name: {equals: dept, mode: 'insensitive'}}]},
    select: {id: true, name: true},
    orderBy: {position: 'asc'},
  });
  if (!d) throw invalid({dept: 'Choose an existing department'});
  const cat = await db.category.findFirst({
    where: {departmentId: d.id, OR: [{slug: slugify(category)}, {name: {equals: category, mode: 'insensitive'}}]},
    select: {id: true},
    orderBy: {position: 'asc'},
  });
  if (!cat) throw invalid({category: `Choose a category in ${d.name}`});
  return {departmentId: d.id, categoryId: cat.id};
}

/** 409 `sku_taken` when a variant SKU repeats in the payload, or a SKU belongs to another product. */
export async function assertSkus(db: Db, productId: string | null, sku: string, variants: {id: string}[]) {
  const fields: Record<string, string> = {};
  const seen = new Map<string, number>();
  variants.forEach((v, i) => {
    if (seen.has(v.id)) fields[`variants.${i}.id`] = 'This SKU is used twice';
    else seen.set(v.id, i);
  });
  const [productSku, taken] = await Promise.all([
    db.product.findFirst({where: {sku, ...(productId ? {NOT: {id: productId}} : {})}, select: {id: true}}),
    db.variant.findMany({
      where: {id: {in: [...seen.keys()]}, ...(productId ? {NOT: {productId}} : {})},
      select: {id: true},
      take: MAX_VARIANTS,
    }),
  ]);
  if (productSku) fields.sku = `${sku} is already used by another product`;
  for (const t of taken) fields[`variants.${seen.get(t.id)}.id`] = `${t.id} is already used by another product`;
  if (Object.keys(fields).length) throw conflict('SKU_TAKEN', 'Some SKUs are already in use', fields);
}

/**
 * Platform images must be files uploaded here (a ready `media_uploads` row): never trust a file id
 * from the browser (docs/agent/files.md). https images pass as they are. 422 `images.<i>.src`.
 */
export async function assertUploads(db: Db, images: {src: string}[]) {
  const wanted = new Map<string, number[]>();
  images.forEach((img, i) => {
    const parsed = parseImageSrc(img.src);
    if (parsed?.kind === 'file') wanted.set(parsed.fileId, [...(wanted.get(parsed.fileId) ?? []), i]);
  });
  if (!wanted.size) return;
  const ready = await db.mediaUpload.findMany({
    where: {fileId: {in: [...wanted.keys()]}, ready: true},
    select: {fileId: true},
    take: MAX_IMAGES,
  });
  const ok = new Set(ready.map(r => r.fileId));
  const fields: Record<string, string> = {};
  for (const [fileId, at] of wanted) if (!ok.has(fileId)) for (const i of at) fields[`images.${i}.src`] = 'Upload this image again';
  if (Object.keys(fields).length) throw invalid(fields);
}

/** `product_images.key`: the platform file id for uploads, else the start of the URL (VAREL `mediaKey`). */
export const imageKey = (src: string) => {
  const parsed = parseImageSrc(src);
  return parsed?.kind === 'file' ? parsed.fileId : src.slice(0, 200);
};

export async function loadProduct(db: Db, id: string): Promise<AdminProductRecord> {
  const p = await db.product.findUnique({where: {id}, select: adminProductSelect});
  if (!p) throw notFound('We cannot find that product');
  return p;
}

// ─── Duplicate naming ───────────────────────────────────────────────────────

const NO_FREE_NAME = () => new HttpError(409, 'CONFLICT', 'Could not find a free name for the copy');

/** `base`, `base-2` … `base-999`: every candidate VAREL's `freeValue` tried, in order. */
export const copyCandidates = (base: string) => [base, ...Array.from({length: 998}, (_, i) => `${base}-${i + 2}`)];

/** The first candidate not in `taken`; 409 when none is free. */
export function firstFree(candidates: string[], taken: ReadonlySet<string>): string {
  const free = candidates.find(c => !taken.has(c));
  if (!free) throw NO_FREE_NAME();
  return free;
}

/** `<value><suffix>` cut so every numbered candidate (`-999` more) fits `max`. */
export const copyBase = (value: string, suffix: string, max: number) =>
  `${value.slice(0, Math.max(1, max - suffix.length - 4)).replace(/-+$/, '')}${suffix}`;

/** A free product slug for a copy: `<id>-copy`, `-copy-2`, … (one bounded query). */
export async function freeProductId(db: Db, id: string): Promise<string> {
  const base = copyBase(id, '-copy', 120);
  const rows = await db.product.findMany({where: {id: {startsWith: base}}, select: {id: true}, take: 1000});
  return firstFree(copyCandidates(base), new Set(rows.map(r => r.id)));
}

/** A free product SKU for a copy: `<SKU>-COPY`, `-COPY-2`, … */
export async function freeProductSku(db: Db, sku: string): Promise<string> {
  const base = copyBase(sku, '-COPY', 64);
  const rows = await db.product.findMany({where: {sku: {startsWith: base}}, select: {sku: true}, take: 1000});
  return firstFree(copyCandidates(base), new Set(rows.map(r => r.sku)));
}

/** A variant SKU with a copy suffix, cut to the column's 64 characters. */
export const withSuffix = (id: string, suffix: string) => `${id.slice(0, 64 - suffix.length)}${suffix}`;

/**
 * One suffix for every variant SKU of the copy (`-COPY`, `-COPY-2`, …), so the copy's variants stay
 * recognisable: the first suffix none of whose SKUs exists. Ten suffixes per query, ≤ 10 queries.
 */
export async function freeVariantSuffix(db: Db, variantIds: string[]): Promise<string> {
  const suffixes = copyCandidates('-COPY').slice(0, 100);
  for (let i = 0; i < suffixes.length; i += 10) {
    const batch = suffixes.slice(i, i + 10).filter(s => new Set(variantIds.map(v => withSuffix(v, s))).size === variantIds.length);
    if (!batch.length) continue;
    const ids = batch.flatMap(s => variantIds.map(v => withSuffix(v, s)));
    const taken = new Set(
      (await db.variant.findMany({where: {id: {in: ids}}, select: {id: true}, take: ids.length})).map(r => r.id)
    );
    const free = batch.find(s => variantIds.every(v => !taken.has(withSuffix(v, s))));
    if (free) return free;
  }
  throw NO_FREE_NAME();
}
