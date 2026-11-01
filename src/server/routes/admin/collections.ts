import {Hono} from 'hono';
import {z} from 'zod';

import {Prisma} from '../../../generated/prisma/client';
import {withDb} from '../../../platform/guards';
import type {AdminCollection, AdminCollectionRow, CategoryOrder} from '../../../lib/types/admin/merchandising';
import type {AdminProductRow} from '../../../lib/types/admin/catalog';
import {storedPhoto} from '../../lib/collections';
import {queueEntityTranslation} from '../../lib/contracts';
import type {Db} from '../../lib/db';
import {conflict, invalid, notFound} from '../../lib/errors';
import {slugify} from '../../lib/format';
import {fromCents, fromCentsOrNull} from '../../lib/money';
import {photoOf, stockOf} from '../../lib/serializers';
import {getSettings} from '../../lib/settings';
import {json, params, query} from '../../lib/validate';

/**
 * Admin: Collections and manual category order. Port of VAREL worker/routes/admin/collections.ts:
 * VAREL `/api/admin/collections…` is `/site-api/manage/collections…` here.
 *
 *   GET    /site-api/manage/collections                AdminCollectionRow[]
 *   POST   /site-api/manage/collections                AdminCollectionInput → 201 AdminCollection
 *   PATCH  /site-api/manage/collections/order          {ids} → AdminCollectionRow[]
 *   GET    /site-api/manage/collections/category-order CategoryOrder ?category=
 *   PATCH  /site-api/manage/collections/product-order  VAREL PATCH /api/admin/products/order: {category, productIds} → CategoryOrder
 *   GET    /site-api/manage/collections/:id            AdminCollection
 *   PATCH  /site-api/manage/collections/:id            Partial<AdminCollectionInput> → AdminCollection
 *   DELETE /site-api/manage/collections/:id            204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check`
 * (area: products; reads: products or discounts), then the activity log. Each handler adds its
 * validator and `withDb`. The admin reads and writes SOURCE text (never translated). Collections
 * are small: lists are capped at 100 rows (no paging), a collection at 100 products.
 *
 * Ids: F1 made collection and category ids `Int`; the wire carries them as strings (F3 contract).
 */

// ─── Rows ─────────────────────────────────────────────────────────────────────

/** What `AdminProductRow` reads (VAREL `adminProductRow` over `productInclude`), as an explicit select. */
export const ADMIN_PRODUCT_ROW_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  priceCents: true,
  compareAtCents: true,
  sku: true,
  updatedAt: true,
  allowBackorder: true,
  department: {select: {name: true}},
  category: {select: {name: true}},
  images: {orderBy: {position: 'asc'}, take: 1, select: {src: true, credit: true, creditHref: true}},
  variants: {take: 100, select: {inventory: true}},
} satisfies Prisma.ProductSelect;

type AdminProductRowSource = Prisma.ProductGetPayload<{select: typeof ADMIN_PRODUCT_ROW_SELECT}>;

/** VAREL `adminProductRow`: money in major units, inventory summed (null for digital). */
export function toAdminProductRow(p: AdminProductRowSource, lowStock: number): AdminProductRow {
  const digital = p.type === 'digital';
  return {
    id: p.id,
    name: p.name,
    dept: p.department.name,
    category: p.category.name,
    type: p.type as AdminProductRow['type'],
    status: p.status as AdminProductRow['status'],
    price: fromCents(p.priceCents),
    compareAt: fromCentsOrNull(p.compareAtCents),
    sku: p.sku,
    image: p.images[0] ? photoOf(p.images[0]) : null,
    variantCount: p.variants.length,
    inventory: digital ? null : p.variants.reduce((n, v) => n + (v.inventory ?? 0), 0),
    stock: stockOf(p, lowStock),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Most collections the admin lists, and most products in one collection or one category order. */
export const ADMIN_COLLECTION_LIMIT = 100;

const ROW_SELECT = {
  id: true,
  slug: true,
  title: true,
  image: true,
  published: true,
  featuredOnHome: true,
  position: true,
  updatedAt: true,
  _count: {select: {products: true}},
} satisfies Prisma.CollectionSelect;

type RowSource = Prisma.CollectionGetPayload<{select: typeof ROW_SELECT}>;

const rowOf = (c: RowSource): AdminCollectionRow => ({
  id: String(c.id),
  slug: c.slug,
  title: c.title,
  image: storedPhoto(c.image),
  published: c.published,
  featuredOnHome: c.featuredOnHome,
  position: c.position,
  productCount: c._count.products,
  updatedAt: c.updatedAt.toISOString(),
});

/** Every collection in merchandising order (≤ 100). */
async function listRows(db: Db): Promise<AdminCollectionRow[]> {
  const rows = await db.collection.findMany({
    orderBy: [{position: 'asc'}, {createdAt: 'asc'}, {id: 'asc'}],
    take: ADMIN_COLLECTION_LIMIT,
    select: ROW_SELECT,
  });
  return rows.map(rowOf);
}

/** One collection with its products in link order, or a 404. */
async function detail(db: Db, id: number): Promise<AdminCollection> {
  const [c, {lowStockThreshold}] = await Promise.all([
    db.collection.findUnique({
      where: {id},
      select: {
        ...ROW_SELECT,
        description: true,
        seoTitle: true,
        seoDescription: true,
        products: {
          orderBy: {position: 'asc'},
          take: ADMIN_COLLECTION_LIMIT,
          select: {product: {select: ADMIN_PRODUCT_ROW_SELECT}},
        },
      },
    }),
    getSettings(db),
  ]);
  if (!c) throw notFound('We cannot find that collection');
  return {
    ...rowOf(c),
    description: c.description,
    seoTitle: c.seoTitle,
    seoDescription: c.seoDescription,
    products: c.products.map(l => toAdminProductRow(l.product, lowStockThreshold)),
  };
}

// ─── Input ────────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .nullish()
    .transform(v => (v ? v : null));

/** An image this site may show: https, or an upload on this site (`/__platform/files/…`; VAREL `/api/media/…`). */
export const isAllowedImageSrc = (s: string) =>
  /^https:\/\//i.test(s) || (s.startsWith('/') && !s.startsWith('//') && !s.includes('\\'));

const imageInput = z
  .object({
    src: z
      .string({error: 'Add an image'})
      .trim()
      .min(1, 'Add an image')
      .max(2000)
      .refine(isAllowedImageSrc, 'Use an https URL or an uploaded image'),
    credit: z.string().trim().max(200).optional().default(''),
    creditHref: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .default('')
      .refine(s => s === '' || /^https:\/\//i.test(s), 'Use an https link'),
  })
  .nullable();

/** Product ids (slugs) in order: unique, at most 100 (the most a collection shows). */
const productIdList = (label: string) =>
  z
    .array(z.string().trim().min(1).max(120), {error: `Send a list of ${label}`})
    .max(ADMIN_COLLECTION_LIMIT, `Use ${ADMIN_COLLECTION_LIMIT} ${label} or fewer`)
    .refine(xs => new Set(xs).size === xs.length, `Each of the ${label} can appear once`);

const positiveId = (message: string) =>
  z
    .union([z.string(), z.number()], {error: message})
    .transform(v => (typeof v === 'number' ? v : /^\s*\d+\s*$/.test(v) ? Number(v) : NaN))
    .pipe(z.number({error: message}).int(message).positive(message).max(2_147_483_647, message));

const title = z.string({error: 'Enter a title'}).trim().min(1, 'Enter a title').max(120, 'Keep the title under 120 characters');
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(120, 'Keep the slug under 120 characters')
  .regex(SLUG_RE, 'Use lowercase letters, numbers and single dashes')
  .optional()
  .or(z.literal('').transform(() => undefined));
const description = z.string().trim().max(10_000, 'Keep the description under 10,000 characters');

export const createCollectionBody = z.object({
  title,
  slug,
  description: description.optional().default(''),
  image: imageInput.optional().default(null),
  published: z.boolean({error: 'Choose published or hidden'}).optional().default(true),
  featuredOnHome: z.boolean({error: 'Choose whether it is featured'}).optional().default(false),
  seoTitle: nullableText(70),
  seoDescription: nullableText(170),
  productIds: productIdList('products').optional().default([]),
});

export const updateCollectionBody = z
  .object({
    title,
    slug,
    description,
    image: imageInput,
    published: z.boolean({error: 'Choose published or hidden'}),
    featuredOnHome: z.boolean({error: 'Choose whether it is featured'}),
    seoTitle: nullableText(70),
    seoDescription: nullableText(170),
    productIds: productIdList('products'),
  })
  .partial();

export const collectionOrderBody = z.object({
  ids: z
    .array(positiveId('Send a list of collections'), {error: 'Send a list of collections'})
    .min(1, 'Send at least one collection')
    .max(ADMIN_COLLECTION_LIMIT, `Use ${ADMIN_COLLECTION_LIMIT} collections or fewer`)
    .refine(xs => new Set(xs).size === xs.length, 'Each of the collections can appear once'),
});

export const categoryOrderQuery = z.object({category: positiveId('Choose a category')});

export const productOrderBody = z.object({
  category: positiveId('Choose a category'),
  productIds: productIdList('products').refine(xs => xs.length > 0, 'Send at least one product'),
});

/** `:id` of a collection; anything else is a missing collection (404, not 422). */
const idParam = z.object({id: z.string().optional()});
const collectionId = (raw: string | undefined): number => {
  const id = /^[1-9][0-9]{0,9}$/.test(raw ?? '') ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) throw notFound('We cannot find that collection');
  return id;
};

async function assertProducts(db: Db, productIds: string[]): Promise<void> {
  if (!productIds.length) return;
  const found = await db.product.findMany({where: {id: {in: productIds}}, select: {id: true}, take: ADMIN_COLLECTION_LIMIT});
  const known = new Set(found.map(p => p.id));
  const missing = productIds.filter(id => !known.has(id));
  if (missing.length) throw invalid({productIds: `We cannot find ${missing.join(', ')}`});
}

async function assertSlugFree(db: Db, slugValue: string, exceptId?: number): Promise<void> {
  const taken = await db.collection.findUnique({where: {slug: slugValue}, select: {id: true}});
  if (taken && taken.id !== exceptId) throw conflict('SLUG_TAKEN', 'Another collection already uses that slug', {slug: 'Choose another slug'});
}

type ImageInput = z.output<typeof imageInput>;

/** undefined = leave as is, null = remove the image. */
const imageJson = (img: ImageInput | undefined) => (img === undefined ? undefined : img === null ? Prisma.DbNull : img);

/** Products of a category in their storefront "featured" order (categoryPosition, then the global position). */
async function categoryOrder(db: Db, categoryId: number): Promise<CategoryOrder> {
  const [cat, products, {lowStockThreshold}] = await Promise.all([
    db.category.findUnique({
      where: {id: categoryId},
      select: {id: true, name: true, slug: true, department: {select: {name: true, slug: true}}},
    }),
    db.product.findMany({
      where: {categoryId, status: {not: 'archived'}},
      orderBy: [{categoryPosition: 'asc'}, {position: 'asc'}, {name: 'asc'}, {id: 'asc'}],
      take: ADMIN_COLLECTION_LIMIT,
      select: ADMIN_PRODUCT_ROW_SELECT,
    }),
    getSettings(db),
  ]);
  if (!cat) throw notFound('We cannot find that category');
  return {
    category: {id: String(cat.id), name: cat.name, slug: cat.slug, dept: cat.department.name, deptSlug: cat.department.slug},
    products: products.map(p => toAdminProductRow(p, lowStockThreshold)),
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const collectionsAdmin = new Hono()
  .get('/', withDb, async c => c.json(await listRows(c.var.db)))

  .post('/', json(createCollectionBody), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const slugValue = input.slug || slugify(input.title);
    if (!slugValue) throw invalid({slug: 'Enter a slug'});
    await Promise.all([assertSlugFree(db, slugValue), assertProducts(db, input.productIds)]);
    const last = await db.collection.findFirst({orderBy: {position: 'desc'}, select: {position: true}});
    const created = await db.collection.create({
      data: {
        slug: slugValue,
        title: input.title,
        description: input.description,
        image: input.image ?? undefined,
        published: input.published,
        featuredOnHome: input.featuredOnHome,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        position: (last?.position ?? -1) + 1,
        products: {create: input.productIds.map((productId, position) => ({productId, position}))},
      },
      select: {id: true},
    });
    await queueEntityTranslation(db, 'collection', created.id, {requestUrl: c.req.url});
    return c.json(await detail(db, created.id), 201);
  })

  /** Set the merchandising order of collections: ids in the new order (ids not sent keep their position). */
  .patch('/order', json(collectionOrderBody), withDb, async c => {
    const {ids} = c.req.valid('json');
    const db = c.var.db;
    const existing = await db.collection.findMany({where: {id: {in: ids}}, select: {id: true}});
    if (existing.length !== ids.length) throw invalid({ids: 'One or more collections no longer exist. Reload and try again'});
    await db.$transaction(ids.map((id, position) => db.collection.update({where: {id}, data: {position}, select: {id: true}})));
    return c.json(await listRows(db));
  })

  .get('/category-order', query(categoryOrderQuery), withDb, async c => {
    const {category} = c.req.valid('query');
    return c.json(await categoryOrder(c.var.db, category));
  })

  /** VAREL PATCH /products/order: categoryPosition 0..n in the order sent. */
  .patch('/product-order', json(productOrderBody), withDb, async c => {
    const {category, productIds} = c.req.valid('json');
    const db = c.var.db;
    const found = await db.product.findMany({where: {id: {in: productIds}}, select: {id: true, categoryId: true}, take: ADMIN_COLLECTION_LIMIT});
    const categoryOf = new Map(found.map(p => [p.id, p.categoryId]));
    const wrong = productIds.filter(id => categoryOf.get(id) !== category);
    if (wrong.length) throw invalid({productIds: `Not in this category: ${wrong.join(', ')}`});
    await db.$transaction(
      productIds.map((id, categoryPosition) => db.product.update({where: {id}, data: {categoryPosition}, select: {id: true}}))
    );
    return c.json(await categoryOrder(db, category));
  })

  .get('/:id', params(idParam), withDb, async c => c.json(await detail(c.var.db, collectionId(c.req.valid('param').id))))

  .patch('/:id', params(idParam), json(updateCollectionBody), withDb, async c => {
    const id = collectionId(c.req.valid('param').id);
    const input = c.req.valid('json');
    const db = c.var.db;
    const current = await db.collection.findUnique({where: {id}, select: {id: true}});
    if (!current) throw notFound('We cannot find that collection');
    await Promise.all([
      input.slug ? assertSlugFree(db, input.slug, id) : undefined,
      input.productIds ? assertProducts(db, input.productIds) : undefined,
    ]);
    const update = db.collection.update({
      where: {id},
      data: {
        title: input.title,
        slug: input.slug,
        description: input.description,
        image: imageJson(input.image),
        published: input.published,
        featuredOnHome: input.featuredOnHome,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
      },
      select: {id: true},
    });
    const ids = input.productIds;
    if (ids) {
      await db.$transaction([
        update,
        db.collectionProduct.deleteMany({where: {collectionId: id}}),
        ...(ids.length ? [db.collectionProduct.createMany({data: ids.map((productId, position) => ({collectionId: id, productId, position}))})] : []),
      ]);
    } else {
      await update;
    }
    await queueEntityTranslation(db, 'collection', id, {requestUrl: c.req.url});
    return c.json(await detail(db, id));
  })

  .delete('/:id', params(idParam), withDb, async c => {
    const id = collectionId(c.req.valid('param').id);
    // Links cascade (FK); the products themselves are untouched.
    const {count} = await c.var.db.collection.deleteMany({where: {id}});
    if (!count) throw notFound('We cannot find that collection');
    return c.body(null, 204);
  });
