import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma, PrismaClient} from '../../../generated/prisma/client';
import {requirePermission, withDb} from '../../../platform/guards';
import type {InventoryRow} from '../../../lib/types/admin/catalog';
import type {CursorPage} from '../../../lib/types/common';
import {invalid, notFound} from '../../lib/errors';
import {decodeCursor, keysetPage, pageSizeOf} from '../../lib/http';
import {LOW_STOCK, photoOf} from '../../lib/serializers';
import {json, query} from '../../lib/validate';
import {optionValues} from '../../lib/variant-options';
import {PERMISSIONS} from '../../permissions';

/**
 * Admin: Inventory (WP-18). Port of VAREL worker/routes/admin/products.ts (inventory part) and the
 * `inventoryRow` / `variantState` serializers: VAREL `/api/admin/inventory…` is `/site-api/manage/inventory…`.
 *
 *   GET    /site-api/manage/inventory                  CursorPage<InventoryRow> ?q&state&cursor&pageSize
 *   POST   /site-api/manage/inventory/bulk             {updates: {variantId, inventory}[]} → {updated}
 *   PATCH  /site-api/manage/inventory/:variantId       {inventory} | {adjust} → InventoryRow
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products), then the activity log. Writes also `requirePermission(PRODUCT_MANAGE)`.
 *
 * Differences from VAREL: the list is filtered in SQL (search words, stock state from the store's
 * low-stock threshold) and keyset-paged in (product position, product id, variant position, SKU)
 * order instead of loading every variant; `sort` is not accepted (the screen never sent it).
 * Writes are race-free: an adjustment is one `UPDATE … GREATEST(0, inventory + n)`, a bulk update
 * one `UPDATE … FROM unnest(…)`.
 */

type Db = PrismaClient;
type State = InventoryRow['state'];

export const INVENTORY_STATES = ['in', 'low', 'out'] as const;
/** Search words beyond this are ignored; each word is cut to 64 characters. */
export const MAX_WORDS = 8;
export const MAX_BULK = 500;
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ─── Validation ───────────────────────────────────────────────────────────────

export const inventoryQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional(),
  state: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(v => [
      ...new Set(
        (Array.isArray(v) ? v : v ? [v] : [])
          .flatMap(s => s.split(','))
          .map(s => s.trim())
          .filter(Boolean)
      ),
    ])
    .refine(list => list.every(s => (INVENTORY_STATES as readonly string[]).includes(s)), 'Use in, low, out')
    .transform(list => list as State[]),
  cursor: z.string().trim().max(512).optional(),
  pageSize: z.string().optional(),
});

const stockField = z.coerce
  .number({error: 'Enter the stock'})
  .int('Use a whole number')
  .min(0, 'Use zero or more')
  .max(1_000_000, 'Use 1000000 or less');

export const adjustBody = z
  .object({
    inventory: stockField.optional(),
    adjust: z.coerce
      .number({error: 'Enter an adjustment'})
      .int('Use a whole number')
      .min(-1_000_000, 'Use -1000000 or more')
      .max(1_000_000, 'Use 1000000 or less')
      .optional(),
  })
  .refine(b => (b.inventory === undefined) !== (b.adjust === undefined), {
    message: 'Send either inventory or adjust',
    path: ['inventory'],
  });

export const bulkBody = z.object({
  updates: z
    .array(
      z.object({
        variantId: z.string({error: 'Choose a variant'}).trim().min(1, 'Choose a variant').max(64, 'Choose a variant'),
        inventory: stockField,
      })
    )
    .min(1, 'Send at least one update')
    .max(MAX_BULK, `Send ${MAX_BULK} updates or fewer`),
});

// ─── Helpers (exported for the unit tests) ────────────────────────────────────

/** Per-variant stock: 0 out, 1–threshold low, otherwise in (same threshold as the storefront). */
export const variantState = (inventory: number, lowStock: number): State =>
  inventory <= 0 ? 'out' : inventory <= lowStock ? 'low' : 'in';

/** The search words: whitespace-split, at most 8, each at most 64 characters. */
export const searchWords = (q: string | undefined): string[] =>
  (q ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .map(w => w.slice(0, 64));

/** The `inventory` filter for a set of stock states (`{}` when none or all). */
export function stateWhere(states: readonly State[], lowStock: number): Prisma.VariantWhereInput {
  const picked = [...new Set(states)];
  if (!picked.length || picked.length === INVENTORY_STATES.length) return {};
  const one = (s: State): Prisma.VariantWhereInput =>
    s === 'out' ? {inventory: {lte: 0}} : s === 'low' ? {inventory: {gte: 1, lte: lowStock}} : {inventory: {gt: lowStock}};
  return picked.length === 1 ? one(picked[0]!) : {OR: picked.map(one)};
}

/** Every search word must match the SKU, colour, exact size, product name or product SKU (VAREL). */
export function searchWhere(words: readonly string[]): Prisma.VariantWhereInput {
  if (!words.length) return {};
  return {
    AND: words.map(w => ({
      OR: [
        {id: {contains: w, mode: 'insensitive' as const}},
        {color: {contains: w, mode: 'insensitive' as const}},
        {size: {equals: w, mode: 'insensitive' as const}},
        {product: {name: {contains: w, mode: 'insensitive' as const}}},
        {product: {sku: {contains: w, mode: 'insensitive' as const}}},
      ],
    })),
  };
}

/** The 4-part keyset cursor `[productPosition, productId, variantPosition, variantId]`, or null. */
export function inventoryCursor(cursor: string | undefined): [number, string, number, string] | null {
  const v = decodeCursor(cursor, 4);
  if (!v) return null;
  const [pp, pid, vp, vid] = v;
  if (!Number.isSafeInteger(pp) || !Number.isSafeInteger(vp)) return null;
  if (typeof pid !== 'string' || typeof vid !== 'string' || !pid || !vid || pid.length > 120 || vid.length > 64) return null;
  return [pp as number, pid, vp as number, vid];
}

/** Rows after the cursor in (product.position, productId, position, id) order. */
export function afterWhere(after: [number, string, number, string] | null): Prisma.VariantWhereInput {
  if (!after) return {};
  const [pp, pid, vp, vid] = after;
  return {
    OR: [
      {product: {position: {gt: pp}}},
      {product: {position: pp}, productId: {gt: pid}},
      {product: {position: pp}, productId: pid, position: {gt: vp}},
      {product: {position: pp}, productId: pid, position: vp, id: {gt: vid}},
    ],
  };
}

/** Only physical, non-archived products have stock to count (drafts included). */
const PHYSICAL: Prisma.VariantWhereInput = {inventory: {not: null}, product: {type: 'physical', status: {not: 'archived'}}};

const ORDER: Prisma.VariantOrderByWithRelationInput[] = [
  {product: {position: 'asc'}},
  {productId: 'asc'},
  {position: 'asc'},
  {id: 'asc'},
];

const rowSelect = {
  id: true,
  productId: true,
  color: true,
  size: true,
  options: true,
  inventory: true,
  position: true,
  product: {
    select: {
      name: true,
      position: true,
      images: {select: {src: true, credit: true, creditHref: true}, orderBy: {position: 'asc'}, take: 1},
    },
  },
} satisfies Prisma.VariantSelect;

type RowData = Prisma.VariantGetPayload<{select: typeof rowSelect}>;

export function inventoryRow(v: RowData, lowStock: number): InventoryRow {
  const inventory = v.inventory ?? 0;
  const image = v.product.images[0];
  return {
    variantId: v.id,
    productId: v.productId,
    productName: v.product.name,
    color: v.color,
    size: v.size,
    options: optionValues(v.options),
    inventory,
    state: variantState(inventory, lowStock),
    image: image ? photoOf(image) : null,
  };
}

async function lowStockOf(db: Db): Promise<number> {
  const s = await db.setting.findUnique({where: {id: 1}, select: {lowStockThreshold: true}});
  return s?.lowStockThreshold ?? LOW_STOCK;
}

/** A SKU from the path: 1–64 characters of the SKU alphabet, or 404. */
export function skuParam(raw: string): string {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw notFound('We cannot find that variant');
  }
  if (!id || id.length > 64 || !SKU_RE.test(id)) throw notFound('We cannot find that variant');
  return id;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const inventoryAdmin = new Hono()
  .use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
  })
  .get('/', query(inventoryQuery), withDb, async c => {
    const input = c.req.valid('query');
    const db = c.var.db;
    const size = pageSizeOf(input.pageSize);
    const states = input.state;
    const read = (lowStock: number) =>
      db.variant.findMany({
        where: {
          AND: [PHYSICAL, searchWhere(searchWords(input.q)), stateWhere(states, lowStock), afterWhere(inventoryCursor(input.cursor))],
        },
        select: rowSelect,
        orderBy: ORDER,
        take: size + 1,
      });
    let lowStock: number;
    let rows: RowData[];
    if (states.length) {
      // The threshold shapes the state filter, so it is read first.
      lowStock = await lowStockOf(db);
      rows = await read(lowStock);
    } else {
      [lowStock, rows] = await Promise.all([lowStockOf(db), read(LOW_STOCK)]);
    }
    const page = keysetPage(rows, size, r => [r.product.position, r.productId, r.position, r.id]);
    const body: CursorPage<InventoryRow> = {items: page.items.map(r => inventoryRow(r, lowStock)), nextCursor: page.nextCursor};
    return c.json(body);
  })
  .post('/bulk', requirePermission(PERMISSIONS.PRODUCT_MANAGE), json(bulkBody), withDb, async c => {
    const {updates} = c.req.valid('json');
    const db = c.var.db;
    const found = await db.variant.findMany({
      where: {id: {in: [...new Set(updates.map(u => u.variantId))]}},
      select: {id: true, productId: true, inventory: true, product: {select: {type: true}}},
      take: MAX_BULK,
    });
    const byId = new Map(found.map(v => [v.id, v]));
    const fields: Record<string, string> = {};
    updates.forEach((u, i) => {
      const v = byId.get(u.variantId);
      if (!v) fields[`updates.${i}.variantId`] = 'We cannot find that variant';
      else if (v.product.type === 'digital' || v.inventory === null) fields[`updates.${i}.variantId`] = 'Digital products have no stock to track';
    });
    if (Object.keys(fields).length) throw invalid(fields);

    // VAREL applied the updates in order, so for a repeated SKU the last one wins.
    const latest = new Map<string, number>();
    for (const u of updates) latest.set(u.variantId, u.inventory);
    const ids = [...latest.keys()];
    const counts = [...latest.values()];
    const productIds = [...new Set(ids.map(id => byId.get(id)!.productId))];
    const [updated] = await db.$transaction([
      db.$executeRaw`UPDATE variants AS v SET inventory = u.inv, updated_at = now()
        FROM unnest(${ids}::text[], ${counts}::int[]) AS u(id, inv)
        WHERE v.id = u.id AND v.inventory IS NOT NULL`,
      db.product.updateMany({where: {id: {in: productIds}}, data: {updatedAt: new Date()}}),
    ]);
    return c.json({updated});
  })
  .patch('/:variantId', requirePermission(PERMISSIONS.PRODUCT_MANAGE), json(adjustBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const id = skuParam(c.req.param('variantId'));
    const v = await db.variant.findUnique({
      where: {id},
      select: {id: true, productId: true, inventory: true, product: {select: {type: true}}},
    });
    if (!v) throw notFound('We cannot find that variant');
    if (v.product.type === 'digital' || v.inventory === null) throw invalid({variantId: 'Digital products have no stock to track'});

    const write =
      input.inventory !== undefined
        ? db.variant.updateMany({where: {id, inventory: {not: null}}, data: {inventory: input.inventory}})
        : db.$executeRaw`UPDATE variants SET inventory = GREATEST(0, inventory + ${input.adjust ?? 0}::int), updated_at = now()
            WHERE id = ${id} AND inventory IS NOT NULL`;
    await db.$transaction([write, db.product.update({where: {id: v.productId}, data: {updatedAt: new Date()}, select: {id: true}})]);

    const [row, lowStock] = await Promise.all([db.variant.findUnique({where: {id}, select: rowSelect}), lowStockOf(db)]);
    if (!row) throw notFound('We cannot find that variant');
    return c.json(inventoryRow(row, lowStock));
  });
