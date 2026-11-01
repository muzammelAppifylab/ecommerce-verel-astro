import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import type {AdminProduct} from '../../../lib/types/admin/catalog';
import {withDb} from '../../../platform/guards';
import {queueEntityTranslation} from '../../lib/contracts';
import type {Db} from '../../lib/db';
import {conflict, invalid, notFound} from '../../lib/errors';
import {slugify} from '../../lib/format';
import {decodeCursor, keysetPage, parseSort, sortProblem} from '../../lib/http';
import {round2, toCents, toCentsOrNull} from '../../lib/money';
import {getSettings} from '../../lib/settings';
import {json, multiValue, pageQuery, params, query} from '../../lib/validate';
import {MAX_OPTIONS, optionValues} from '../../lib/variant-options';
import {
  adminProduct,
  adminProductRow,
  assertSkus,
  assertUploads,
  cursorArity,
  cursorOf,
  freeProductId,
  freeProductSku,
  freeVariantSuffix,
  imageKey,
  listProducts,
  loadProduct,
  MAX_IMAGES,
  MAX_VARIANTS,
  orderCountOf,
  parseImageSrc,
  PRODUCT_SORT_FIELDS,
  resolveTaxonomy,
  STOCK_STATES,
  withSuffix,
} from './products-shared';

/**
 * Admin: Products. WP-17 (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/admin/products.ts (products part): VAREL `/api/admin/products…` is `/site-api/manage/products…` here.
 * Shapes: src/lib/types/admin/*. Lists are keyset pages (`CursorPage`, src/server/lib/http.ts).
 *
 *   GET    /site-api/manage/products                   CursorPage<AdminProductRow> ?q&status&dept&category&stock&sort&cursor&pageSize
 *   POST   /site-api/manage/products                   AdminProductInput → 201 AdminProduct (409 slug_taken, sku_taken)
 *   GET    /site-api/manage/products/:id               AdminProduct
 *   PATCH  /site-api/manage/products/:id               Partial<AdminProductInput> → AdminProduct
 *   DELETE /site-api/manage/products/:id               204, or 200 {archived: true} when it was ordered
 *   POST   /site-api/manage/products/:id/duplicate     201 AdminProduct (draft copy)
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products (reads: products or discounts); MANAGE_AREAS in src/server/permissions.ts), then the
 * activity log. Handlers add their validator and `withDb`. The admin reads and writes SOURCE fields
 * only (never `localize`).
 *
 * Differences from VAREL: the list is one keyset SQL query (no totals, no offset pages); money is
 * cents in the database; images are https URLs or platform public files uploaded through
 * `/manage/uploads` (D8); a compare-at price must be above the price, a digital product needs its
 * download file, and an ordered product's type cannot change (the editor's own rules, now checked
 * on the server too).
 */

// ─── Input schemas (VAREL, messages verbatim) ───────────────────────────────

const moneyField = (label: string) =>
  z.coerce
    .number({error: `Enter ${label}`})
    .min(0, `Enter ${label} of zero or more`)
    .max(1_000_000, `Keep ${label} under $1,000,000`)
    .transform(round2);

const text = (label: string, max: number) =>
  z.string({error: `Enter ${label}`}).trim().min(1, `Enter ${label}`).max(max, `Keep ${label} under ${max} characters`);

const longText = (max: number) => z.string({error: 'Check this field'}).trim().max(max, `Keep this under ${max} characters`);

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .nullable()
    .transform(v => (v ? v : null));

export const skuField = z
  .string({error: 'Enter a SKU'})
  .trim()
  .min(1, 'Enter a SKU')
  .max(64, 'Keep the SKU under 64 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use letters, numbers, dots, dashes and underscores')
  .transform(s => s.toUpperCase());

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .max(120, 'Keep the slug under 120 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes');

const imageInput = z.object({
  src: z
    .string({error: 'Add an image URL'})
    .trim()
    .min(1, 'Add an image URL')
    .max(2000, 'Keep the image URL under 2000 characters')
    .refine(s => parseImageSrc(s) !== null, 'Use an https URL or an uploaded image'),
  credit: nullableText(200).optional(),
  creditHref: nullableText(2000).optional(),
});

const variantInput = z.object({
  id: skuField,
  color: nullableText(60),
  size: nullableText(40),
  swatch: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #CFC8BE')
    .nullable()
    .or(z.literal('').transform(() => null)),
  price: moneyField('a price'),
  inventory: z.coerce
    .number({error: 'Enter the stock'})
    .int('Use a whole number')
    .min(0, 'Use zero or more')
    .max(1_000_000, 'Use a smaller number')
    .nullable(),
  /** Custom option values, e.g. { Fabric: 'Canvas' } */
  options: z
    .record(z.string().trim().min(1).max(40), z.string().trim().min(1, 'Enter a value').max(60, 'Keep values under 60 characters'))
    .optional()
    .default({}),
});

const optionDefInput = z.object({
  kind: z.enum(['color', 'size', 'custom']),
  name: z.string().trim().min(1, 'Name the option').max(40, 'Keep option names under 40 characters'),
  values: z.array(z.string().trim().min(1).max(60)).max(100, 'Use 100 values or fewer'),
});

const measure = z.coerce.number({error: 'Use a number'}).min(0, 'Use zero or more').max(100_000, 'Use a smaller number').nullable();

const productFields = {
  id: slugField.optional(),
  name: text('a name', 160),
  brand: text('a brand', 80),
  dept: text('a department', 80),
  category: text('a category', 80),
  type: z.enum(['physical', 'digital'], {error: 'Choose physical or digital'}),
  status: z.enum(['draft', 'published', 'archived'], {error: 'Choose draft, published or archived'}),
  price: moneyField('a price'),
  compareAt: moneyField('a compare-at price').nullable(),
  sku: skuField,
  short: longText(300),
  description: longText(10_000),
  material: longText(120),
  care: nullableText(2000),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(40), {error: 'Use a list of tags'})
    .max(30, 'Use 30 tags or fewer')
    .transform(t => Array.from(new Set(t))),
  download: z
    .string()
    .trim()
    .max(200)
    .regex(/^[\w.-]+$/, 'Use a file name such as varel-care-guide.pdf')
    .nullable()
    .or(z.literal('').transform(() => null)),
  images: z.array(imageInput, {error: 'Use a list of images'}).max(MAX_IMAGES, 'Use 20 images or fewer'),
  variants: z
    .array(variantInput, {error: 'Add at least one variant'})
    .min(1, 'Add at least one variant')
    .max(MAX_VARIANTS, 'Use 200 variants or fewer'),
  allowBackorder: z.boolean({error: 'Use true or false'}),
  featured: z.boolean({error: 'Use true or false'}),
  categoryPosition: z.coerce.number({error: 'Use a number'}).int('Use a whole number').min(0, 'Use zero or more').max(100_000),
  seoTitle: nullableText(120),
  seoDescription: nullableText(320),
  options: z
    .array(optionDefInput, {error: 'Use a list of options'})
    .max(MAX_OPTIONS, `Use ${MAX_OPTIONS} options or fewer`)
    .refine(list => new Set(list.map(o => o.name.toLowerCase())).size === list.length, 'Option names must be different'),
  costPerItem: moneyField('a cost').nullable(),
  weight: measure,
  weightUnit: z.enum(['kg', 'g', 'lb', 'oz'], {error: 'Choose kg, g, lb or oz'}),
  packageLength: measure,
  packageWidth: measure,
  packageHeight: measure,
  dimensionUnit: z.enum(['cm', 'in'], {error: 'Choose cm or in'}),
};

export const createSchema = z.object({
  ...productFields,
  status: productFields.status.optional(),
  compareAt: productFields.compareAt.optional(),
  short: productFields.short.optional(),
  description: productFields.description.optional(),
  material: productFields.material.optional(),
  care: productFields.care.optional(),
  tags: productFields.tags.optional(),
  download: productFields.download.optional(),
  images: productFields.images.optional(),
  allowBackorder: productFields.allowBackorder.optional(),
  featured: productFields.featured.optional(),
  categoryPosition: productFields.categoryPosition.optional(),
  seoTitle: productFields.seoTitle.optional(),
  seoDescription: productFields.seoDescription.optional(),
  costPerItem: productFields.costPerItem.optional(),
  weight: productFields.weight.optional(),
  weightUnit: productFields.weightUnit.optional(),
  packageLength: productFields.packageLength.optional(),
  packageWidth: productFields.packageWidth.optional(),
  packageHeight: productFields.packageHeight.optional(),
  dimensionUnit: productFields.dimensionUnit.optional(),
  options: productFields.options.optional(),
});

export const patchSchema = z.object(productFields).partial();

/** A multi-value query param limited to a list (VAREL `multiOf`): 422 on the param itself. */
const multiOf = <T extends string>(allowed: readonly T[]) =>
  multiValue()
    .refine(v => v.every(s => (allowed as readonly string[]).includes(s)), `Use ${allowed.join(', ')}`)
    .transform(v => v as T[]);

export const listQuery = z.object({
  q: z.string().trim().max(200, 'Keep the search under 200 characters').optional().default(''),
  status: multiOf(['draft', 'published', 'archived'] as const),
  dept: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  stock: multiOf(STOCK_STATES),
  sort: z.string().trim().max(40).optional(),
  ...pageQuery,
});

const idParam = z.object({id: z.string().trim().min(1, 'Use a valid id').max(120, 'Use a valid id')});

type VariantIn = z.output<typeof variantInput>;
type ImageIn = z.output<typeof imageInput>;
type CreateIn = z.output<typeof createSchema>;
type ProductType = 'physical' | 'digital';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The product columns of the Phase 2/3 fields present in a body (undefined = unchanged). */
const extraFields = (input: Partial<CreateIn>) => ({
  allowBackorder: input.allowBackorder,
  featured: input.featured,
  categoryPosition: input.categoryPosition,
  seoTitle: input.seoTitle,
  seoDescription: input.seoDescription,
  costCents: input.costPerItem === undefined ? undefined : toCentsOrNull(input.costPerItem),
  weight: input.weight,
  weightUnit: input.weightUnit,
  packageLength: input.packageLength,
  packageWidth: input.packageWidth,
  packageHeight: input.packageHeight,
  dimensionUnit: input.dimensionUnit,
  options: input.options as Prisma.InputJsonValue | undefined,
});

const imageRows = (images: ImageIn[]) =>
  images.map((img, position) => ({
    key: imageKey(img.src),
    src: img.src,
    credit: img.credit ?? '',
    creditHref: img.creditHref ?? '',
    position,
  }));

const variantData = (v: VariantIn, position: number, type: ProductType) => ({
  color: v.color,
  size: v.size,
  swatch: v.swatch,
  options: (type === 'digital' ? {} : (v.options ?? {})) as Prisma.InputJsonValue,
  priceCents: toCents(v.price),
  inventory: type === 'digital' ? null : (v.inventory ?? 0),
  position,
});

/** The editor's own rules, checked on the effective values (sent, else stored). */
function assertRules(
  r: {price: number; compareAt: number | null; type: ProductType; download: string | null},
  check: {compareAt: boolean; download: boolean}
) {
  const fields: Record<string, string> = {};
  if (check.compareAt && r.compareAt !== null && r.compareAt <= r.price) fields.compareAt = 'Compare-at must be higher than the price';
  if (check.download && r.type === 'digital' && !r.download) fields.download = 'Add the download filename';
  if (Object.keys(fields).length) throw invalid(fields);
}

async function respond(db: Db, id: string): Promise<AdminProduct> {
  const [p, count, settings] = await Promise.all([loadProduct(db, id), orderCountOf(db, id), getSettings(db)]);
  return adminProduct(p, count, settings.lowStockThreshold);
}

/** The variants in one statement: new SKUs inserted, the product's own existing ones updated. */
async function upsertVariants(tx: Db, productId: string, variants: VariantIn[], type: ProductType) {
  const rows = variants.map((v, i) => ({id: v.id, ...variantData(v, i, type)}));
  await tx.$executeRaw`
    INSERT INTO variants (id, product_id, color, size, swatch, options, price_cents, inventory, position, created_at, updated_at)
    SELECT u.id, ${productId}, u.color, u.size, u.swatch, u.options::jsonb, u.price_cents, u.inventory, u.position, now(), now()
    FROM unnest(
      ${rows.map(r => r.id)}::text[],
      ${rows.map(r => r.color)}::text[],
      ${rows.map(r => r.size)}::text[],
      ${rows.map(r => r.swatch)}::text[],
      ${rows.map(r => JSON.stringify(r.options))}::text[],
      ${rows.map(r => r.priceCents)}::int[],
      ${rows.map(r => r.inventory)}::int[],
      ${rows.map(r => r.position)}::int[]
    ) AS u(id, color, size, swatch, options, price_cents, inventory, position)
    ON CONFLICT (id) DO UPDATE SET
      color = EXCLUDED.color, size = EXCLUDED.size, swatch = EXCLUDED.swatch, options = EXCLUDED.options,
      price_cents = EXCLUDED.price_cents, inventory = EXCLUDED.inventory, position = EXCLUDED.position,
      updated_at = now()
    WHERE variants.product_id = EXCLUDED.product_id`;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export const productsAdmin = new Hono()
  .get('/', query(listQuery), withDb, async c => {
    const q = c.req.valid('query');
    const sort = parseSort(q.sort, PRODUCT_SORT_FIELDS, '-updatedAt');
    if (!sort) throw invalid(sortProblem(PRODUCT_SORT_FIELDS));
    const size = q.pageSize ?? 25;
    const after = decodeCursor(q.cursor, cursorArity(sort.field));
    const rows = await listProducts(
      c.var.db,
      {q: q.q, status: q.status, dept: q.dept || undefined, category: q.category || undefined, stock: q.stock},
      sort,
      after,
      size
    );
    const page = keysetPage(rows, size, r => cursorOf(sort.field, r));
    c.header('Cache-Control', 'private, no-store');
    return c.json({items: page.items.map(adminProductRow), nextCursor: page.nextCursor});
  })

  .post('/', json(createSchema), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const id = input.id ?? slugify(input.name).slice(0, 120).replace(/-+$/, '');
    if (!id) throw invalid({id: 'Enter a slug'});
    assertRules(
      {price: input.price, compareAt: input.compareAt ?? null, type: input.type, download: input.download ?? null},
      {compareAt: true, download: true}
    );
    if (await db.product.findUnique({where: {id}, select: {id: true}})) {
      throw conflict('SLUG_TAKEN', 'Another product already uses that slug', {id: `${id} is already taken`});
    }
    const tax = await resolveTaxonomy(db, input.dept, input.category);
    await assertSkus(db, null, input.sku, input.variants);
    await assertUploads(db, input.images ?? []);
    const last = await db.product.findFirst({orderBy: {position: 'desc'}, select: {position: true}});

    await db.product.create({
      data: {
        id,
        name: input.name,
        brand: input.brand,
        type: input.type,
        status: input.status ?? 'draft',
        priceCents: toCents(input.price),
        compareAtCents: toCentsOrNull(input.compareAt ?? null),
        sku: input.sku,
        short: input.short ?? '',
        description: input.description ?? '',
        material: input.material ?? '',
        care: input.care ?? null,
        tags: input.tags ?? [],
        download: input.type === 'digital' ? (input.download ?? null) : null,
        position: (last?.position ?? -1) + 1,
        ...extraFields(input),
        allowBackorder: input.type === 'physical' && (input.allowBackorder ?? false),
        ...tax,
        images: {createMany: {data: imageRows(input.images ?? [])}},
        variants: {createMany: {data: input.variants.map((v, i) => ({id: v.id, ...variantData(v, i, input.type)}))}},
      },
    });
    await queueEntityTranslation(db, 'product', id, {requestUrl: c.req.url});
    c.header('Cache-Control', 'private, no-store');
    return c.json(await respond(db, id), 201);
  })

  .get('/:id', params(idParam), withDb, async c => {
    const {id} = c.req.valid('param');
    c.header('Cache-Control', 'private, no-store');
    return c.json(await respond(c.var.db, id));
  })

  .patch('/:id', params(idParam), json(patchSchema), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const existing = await loadProduct(db, c.req.valid('param').id);
    if (input.id && input.id !== existing.id) throw invalid({id: 'The slug cannot change after a product is created'});

    const type = (input.type ?? existing.type) as ProductType;
    const typeChanged = input.type !== undefined && input.type !== existing.type;
    if (typeChanged && (await orderCountOf(db, existing.id)) > 0) {
      throw invalid({type: 'This product is in orders, so its type cannot change'});
    }
    assertRules(
      {
        price: input.price ?? existing.priceCents / 100,
        compareAt: input.compareAt !== undefined ? input.compareAt : existing.compareAtCents === null ? null : existing.compareAtCents / 100,
        type,
        download: input.download !== undefined ? input.download : existing.download,
      },
      {compareAt: input.price !== undefined || input.compareAt !== undefined, download: input.type !== undefined || input.download !== undefined}
    );
    const tax =
      input.dept !== undefined || input.category !== undefined
        ? await resolveTaxonomy(db, input.dept ?? existing.department.name, input.category ?? existing.category.name)
        : null;
    if (input.sku !== undefined || input.variants) {
      await assertSkus(db, existing.id, input.sku ?? existing.sku, input.variants ?? existing.variants);
    }
    if (input.images) await assertUploads(db, input.images);

    await db.$transaction(
      async tx => {
        await tx.product.update({
          where: {id: existing.id},
          data: {
            name: input.name,
            brand: input.brand,
            type: input.type,
            status: input.status,
            priceCents: input.price === undefined ? undefined : toCents(input.price),
            compareAtCents: input.compareAt === undefined ? undefined : toCentsOrNull(input.compareAt),
            sku: input.sku,
            short: input.short,
            description: input.description,
            material: input.material,
            care: input.care,
            tags: input.tags,
            download: type === 'physical' ? null : input.download,
            ...extraFields(input),
            ...(type === 'digital' ? {allowBackorder: false} : {}),
            ...(tax ?? {}),
            updatedAt: new Date(),
          },
        });

        if (input.variants) {
          const incoming = new Set(input.variants.map(v => v.id));
          const removed = existing.variants.filter(v => !incoming.has(v.id)).map(v => v.id);
          if (removed.length) {
            // Bag lines pointing at a removed variant leave the bag with it (the FK cascades too).
            await tx.cartLine.deleteMany({where: {variantId: {in: removed}}});
            await tx.variant.deleteMany({where: {id: {in: removed}, productId: existing.id}});
          }
          await upsertVariants(tx, existing.id, input.variants, type);
        } else if (typeChanged) {
          // Type changed without new variants: digital variants carry no stock, physical ones start at 0.
          await tx.variant.updateMany({where: {productId: existing.id}, data: {inventory: type === 'digital' ? null : 0}});
        }

        if (input.images) {
          await tx.productImage.deleteMany({where: {productId: existing.id}});
          if (input.images.length) {
            await tx.productImage.createMany({data: imageRows(input.images).map(r => ({...r, productId: existing.id}))});
          }
        }
      },
      {timeout: 10_000}
    );
    await queueEntityTranslation(db, 'product', existing.id, {requestUrl: c.req.url});
    c.header('Cache-Control', 'private, no-store');
    return c.json(await respond(db, existing.id));
  })

  .delete('/:id', params(idParam), withDb, async c => {
    const db = c.var.db;
    const p = await db.product.findUnique({where: {id: c.req.valid('param').id}, select: {id: true}});
    if (!p) throw notFound('We cannot find that product');
    c.header('Cache-Control', 'private, no-store');
    const ordered = await db.shopOrderItem.findFirst({where: {productId: p.id}, select: {id: true}});
    if (ordered) {
      // Ordered products keep their history: archive instead (hidden from the storefront).
      await db.product.update({where: {id: p.id}, data: {status: 'archived'}});
      return c.json({archived: true});
    }
    // Images, variants, bag lines, wishlist rows, reviews and collection links go with it (FK cascades).
    await db.$transaction([
      db.translation.deleteMany({where: {entity: 'product', entityId: p.id}}),
      db.product.delete({where: {id: p.id}}),
    ]);
    return c.body(null, 204);
  })

  .post('/:id/duplicate', params(idParam), withDb, async c => {
    const db = c.var.db;
    const src = await loadProduct(db, c.req.valid('param').id);
    const [id, sku, suffix] = await Promise.all([
      freeProductId(db, src.id),
      freeProductSku(db, src.sku),
      freeVariantSuffix(
        db,
        src.variants.map(v => v.id)
      ),
    ]);

    await db.product.create({
      data: {
        id,
        name: `${src.name} (copy)`.slice(0, 160),
        brand: src.brand,
        type: src.type,
        status: 'draft',
        priceCents: src.priceCents,
        compareAtCents: src.compareAtCents,
        sku,
        short: src.short,
        description: src.description,
        material: src.material,
        care: src.care,
        tags: src.tags,
        download: src.download,
        position: src.position,
        costCents: src.costCents,
        weight: src.weight,
        weightUnit: src.weightUnit,
        packageLength: src.packageLength,
        packageWidth: src.packageWidth,
        packageHeight: src.packageHeight,
        dimensionUnit: src.dimensionUnit,
        options: (src.options ?? []) as Prisma.InputJsonValue,
        departmentId: src.departmentId,
        categoryId: src.categoryId,
        images: {
          createMany: {
            data: src.images.map(({key, src: s, credit, creditHref, position}) => ({key, src: s, credit, creditHref, position})),
          },
        },
        variants: {
          createMany: {
            data: src.variants.map(v => ({
              id: withSuffix(v.id, suffix),
              color: v.color,
              size: v.size,
              swatch: v.swatch,
              options: optionValues(v.options),
              priceCents: v.priceCents,
              inventory: v.inventory,
              position: v.position,
            })),
          },
        },
      },
    });
    await queueEntityTranslation(db, 'product', id, {requestUrl: c.req.url});
    c.header('Cache-Control', 'private, no-store');
    return c.json(await respond(db, id), 201);
  });
