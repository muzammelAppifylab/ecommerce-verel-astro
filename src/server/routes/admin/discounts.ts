import {Hono, type Context} from 'hono';
import {z} from 'zod';

import {audit} from '../../../platform/auth';
import {requirePermission, withDb} from '../../../platform/guards';
import type {DiscountPreview} from '../../../lib/types/admin/promotions';
import {PERMISSIONS} from '../../permissions';
import {queueEntityTranslation} from '../../lib/contracts';
import type {Db} from '../../lib/db';
import {conflict, invalid, notFound} from '../../lib/errors';
import {round2} from '../../lib/money';
import {json, multiValue, query} from '../../lib/validate';
import {codesCsv, codesQuerySchema, deleteUnusedCodes, generateCodes, generateSchema, listCodes} from './discount-codes';
import {discountReport} from './discount-report';
import {
  CUSTOMER_WHERE,
  DEFAULTS,
  DISCOUNT_SELECT,
  defaultLabel,
  defaultNote,
  displayNameOf,
  intIds,
  loadTargetNames,
  lockCodes,
  serializeMany,
  serializeOne,
  stateOf,
  toColumns,
  type State,
  type TargetNames,
} from './discount-shared';

/**
 * Admin: Discounts and promotions (docs/PROMOTIONS.md). WP-21: port of VAREL worker/routes/admin/discount*.ts;
 * VAREL `/api/admin/discounts…` is `/site-api/manage/discounts…` here.
 *
 *   GET    /site-api/manage/discounts                  AdminDiscount[] ?q&method&status (newest 100)
 *   POST   /site-api/manage/discounts                  AdminDiscountInput → 201 AdminDiscount; 409 code_taken
 *   GET    /site-api/manage/discounts/preview          DiscountPreview ?q= (scope and customer pickers)
 *   GET    /site-api/manage/discounts/names            {id, name}[] ?kind=product|customer&ids=a,b (chips)
 *   GET    /site-api/manage/discounts/:id              AdminDiscount
 *   PATCH  /site-api/manage/discounts/:id              Partial<AdminDiscountInput> → AdminDiscount
 *   DELETE /site-api/manage/discounts/:id              204, or 200 {deactivated: true, discount} when used
 *   POST   /site-api/manage/discounts/:id/codes        GenerateCodesInput → 201 {created}; 409 codes_exhausted
 *   GET    /site-api/manage/discounts/:id/codes        CursorPage<AdminDiscountCode> ?q&used&cursor&pageSize
 *   GET    /site-api/manage/discounts/:id/codes.csv    CSV of the codes (streamed, ≤ 20,000 rows)
 *   DELETE /site-api/manage/discounts/:id/codes        delete the unused codes → {deleted}
 *   GET    /site-api/manage/discounts/:id/report       AdminDiscountReport
 *
 * Guarded centrally (src/server/routes/admin/index.ts): `withViewer → requireAuth → area check (discounts, reads
 * and writes)`, then the activity log. Each handler: validator → `requirePermission(DISCOUNT_MANAGE)` → `withDb`.
 * The admin works in the SOURCE language: never `localize`. Every answer is `Cache-Control: private, no-store`.
 */

const METHODS = ['code', 'automatic'] as const;
const CODE_TYPES = ['shared', 'unique'] as const;
const KINDS = ['percent', 'fixed', 'shipping', 'bxgy'] as const;
const SCOPES = ['order', 'products', 'categories', 'departments'] as const;
const ELIGIBILITY = ['everyone', 'signed_in', 'first_order', 'subscribers', 'customers'] as const;
const STATUSES = ['active', 'scheduled', 'expired', 'inactive', 'used_up'] as const;

// ─── Input schema ───────────────────────────────────────────────────────────

const when = z
  .string({error: 'Use a date and time'})
  .trim()
  .refine(s => !Number.isNaN(Date.parse(s)), 'Use a date and time')
  .transform(s => new Date(s))
  .nullable();

const wholeOrNull = (min: number, max: number, msg: string, maxMsg = `Use ${max.toLocaleString('en-US')} or less`) =>
  z.coerce.number({error: 'Use a number'}).int('Use a whole number').min(min, msg).max(max, maxMsg).nullable();

const idList = (what: string) =>
  z
    .array(z.string({error: `Choose a ${what}`}).trim().min(1, `Choose a ${what}`).max(120, `Choose a ${what} from the list`), {
      error: `Choose ${what}s from the list`,
    })
    .max(500, `Choose up to 500 ${what}s`)
    .transform(ids => [...new Set(ids)]);

export const inputSchema = z
  .object({
    method: z.enum(METHODS, {error: 'Choose code or automatic'}),
    name: z.string({error: 'Enter a name'}).trim().max(80, 'Keep the name under 80 characters'),
    code: z
      .string({error: 'Enter a code'})
      .trim()
      .toUpperCase()
      .refine(s => s === '' || /^[A-Z0-9_-]{2,40}$/.test(s), 'Use 2–40 letters, numbers, dashes or underscores')
      .nullable(),
    codeType: z.enum(CODE_TYPES, {error: 'Choose shared or unique codes'}),
    kind: z.enum(KINDS, {error: 'Choose percent, fixed, shipping or buy X get Y'}),
    value: z.coerce.number({error: 'Enter a value'}).min(0, 'Use zero or more').max(100_000, 'Use 100,000 or less').transform(round2),
    maxAmount: z.coerce
      .number({error: 'Enter an amount'})
      .min(0, 'Use zero or more')
      .max(1_000_000, 'Use 1,000,000 or less')
      .transform(round2)
      .nullable(),
    buyQty: wholeOrNull(1, 1000, 'Buy at least 1'),
    getQty: wholeOrNull(1, 1000, 'Get at least 1'),
    getPercent: wholeOrNull(1, 100, 'Use a percentage between 1 and 100', 'Use a percentage between 1 and 100'),
    scope: z.enum(SCOPES, {error: 'Choose order, products, categories or departments'}),
    productIds: idList('product'),
    categoryIds: idList('category'),
    departmentIds: idList('department'),
    minimum: z.coerce
      .number({error: 'Enter a minimum spend'})
      .min(0, 'Use zero or more')
      .max(1_000_000, 'Use 1,000,000 or less')
      .transform(round2),
    minimumQty: wholeOrNull(1, 10_000, 'Use at least 1, or leave it empty'),
    eligibility: z.enum(ELIGIBILITY, {error: 'Choose who can use it'}),
    customerIds: idList('customer'),
    usageLimit: wholeOrNull(1, 10_000_000, 'Use at least 1, or leave it empty'),
    perCustomerLimit: wholeOrNull(1, 10_000, 'Use at least 1, or leave it empty'),
    combinable: z.boolean({error: 'Choose yes or no'}),
    priority: z.coerce.number({error: 'Use a number'}).int('Use a whole number').min(-1000, 'Use -1000 or more').max(1000, 'Use 1000 or less'),
    label: z.string({error: 'Enter a label'}).trim().max(60, 'Keep the label under 60 characters'),
    note: z.string({error: 'Enter a note'}).trim().max(200, 'Keep the note under 200 characters'),
    active: z.boolean({error: 'Choose active or inactive'}),
    startsAt: when,
    endsAt: when,
  })
  .partial();

export type Input = z.output<typeof inputSchema>;

/** Overlay the defined input keys on a base state. */
export function overlay(base: State, input: Input): State {
  const out = {...base} as Record<string, unknown>;
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out as unknown as State;
}

/** Normalize the combination (clear fields that don't apply) and validate it. Throws 422 with field paths. */
export function normalize(s: State, input: Input): State {
  const f: Record<string, string> = {};
  const n: State = {...s};

  // Method and codes: automatic discounts have no code; unique batches keep their codes in DiscountCode rows.
  if (n.method === 'automatic') {
    if (input.codeType === 'unique') f.codeType = 'Automatic discounts don’t use codes';
    n.codeType = 'shared';
    n.code = null;
  } else if (n.codeType === 'unique') {
    n.code = null;
  } else if (!n.code) {
    f.code = 'Enter a code';
  }

  // Kind.
  if (n.kind === 'percent') {
    if (!(n.value >= 1 && n.value <= 100)) f.value = 'Use a percentage between 1 and 100';
    if (n.maxAmount != null && n.maxAmount <= 0) f.maxAmount = 'Enter a cap above zero, or leave it empty';
  } else {
    n.maxAmount = null;
  }
  if (n.kind === 'fixed' && !(n.value > 0)) f.value = 'Enter an amount above zero';
  if (n.kind === 'shipping' || n.kind === 'bxgy') n.value = 0;
  if (n.kind === 'bxgy') {
    if (n.buyQty == null) f.buyQty = 'Enter how many to buy (at least 1)';
    if (n.getQty == null) f.getQty = 'Enter how many they get (at least 1)';
    if (n.getPercent == null) f.getPercent = 'Enter a percentage between 1 and 100 (100 = free)';
  } else {
    n.buyQty = null;
    n.getQty = null;
    n.getPercent = null;
  }

  // Scope: only the list for the chosen scope is kept, and it must not be empty.
  if (n.scope !== 'products') n.productIds = [];
  if (n.scope !== 'categories') n.categoryIds = [];
  if (n.scope !== 'departments') n.departmentIds = [];
  if (n.scope === 'products' && !n.productIds.length) f.productIds = 'Choose at least one product';
  if (n.scope === 'categories' && !n.categoryIds.length) f.categoryIds = 'Choose at least one category';
  if (n.scope === 'departments' && !n.departmentIds.length) f.departmentIds = 'Choose at least one department';

  // Eligibility.
  if (n.eligibility !== 'customers') n.customerIds = [];
  else if (!n.customerIds.length) f.customerIds = 'Choose at least one customer';

  // Schedule.
  if (n.startsAt && n.endsAt && n.endsAt <= n.startsAt) f.endsAt = 'End after the start date';

  if (Object.keys(f).length) throw invalid(f);
  return n;
}

type IdsKey = 'productIds' | 'categoryIds' | 'departmentIds' | 'customerIds';

/** Newly added scope targets and customers must exist: 422 `productIds.N` etc. Ids already stored on the discount
    are not re-checked, so a discount whose product or category was deleted since can still be edited or switched off.
    Category, department and customer ids that are not digits count as missing. */
async function checkTargets(db: Db, s: State, before?: State) {
  const f: Record<string, string> = {};
  const missing = async (key: IdsKey, find: (ids: string[]) => Promise<string[]>, msg: string) => {
    const known = new Set(before?.[key] ?? []);
    const added = s[key].filter(id => !known.has(id));
    if (!added.length) return;
    const have = new Set(await find(added));
    s[key].forEach((id, i) => {
      if (!known.has(id) && !have.has(id)) f[`${key}.${i}`] = msg;
    });
  };
  const sel = {select: {id: true}} as const;
  const byInt = async (ids: string[], find: (ints: number[]) => Promise<{id: number}[]>) => {
    const ints = intIds(ids);
    return ints.length ? (await find(ints)).map(r => String(r.id)) : [];
  };
  await Promise.all([
    missing('productIds', async ids => (await db.product.findMany({where: {id: {in: ids}}, ...sel})).map(r => r.id), 'We cannot find that product'),
    missing('categoryIds', ids => byInt(ids, ints => db.category.findMany({where: {id: {in: ints}}, ...sel})), 'We cannot find that category'),
    missing(
      'departmentIds',
      ids => byInt(ids, ints => db.department.findMany({where: {id: {in: ints}}, ...sel})),
      'We cannot find that department'
    ),
    missing(
      'customerIds',
      ids => byInt(ids, ints => db.user.findMany({where: {id: {in: ints}, ...CUSTOMER_WHERE}, ...sel})),
      'We cannot find that customer'
    ),
  ]);
  if (Object.keys(f).length) throw invalid(f);
}

const codeTaken = () => conflict('CODE_TAKEN', 'That code already exists', {code: 'That code already exists'});

/** A shared code must not match another discount's code or any unique code (both stored upper case and
    unique-indexed, so an exact match is VAREL's case-insensitive check without a scan). */
async function checkCode(db: Db, code: string | null, selfId?: number) {
  if (!code) return;
  const [d, u] = await Promise.all([
    db.discount.findFirst({where: {code, ...(selfId ? {id: {not: selfId}} : {})}, select: {id: true}}),
    db.discountCode.findFirst({where: {code}, select: {id: true}}),
  ]);
  if (d || u) throw codeTaken();
}

/** Fill empty label / note / name from the rule (`regenerate`: generated ones follow rule changes). */
async function withDefaults(db: Db, s: State, regenerate: {label: boolean; note: boolean}, names?: TargetNames): Promise<State> {
  const n = {...s};
  if (regenerate.label || !n.label) n.label = defaultLabel(n, names ?? (await loadTargetNames(db, [n])));
  if (regenerate.note || !n.note) n.note = defaultNote(n);
  if (!n.name) n.name = n.code ?? n.label;
  return n;
}

const errorCode = (e: unknown) => (typeof e === 'object' && e !== null ? (e as {code?: unknown}).code : undefined);

/** `:id` → an int4 id, or 404 (the editor's "Discount not found" state keys on 404, not 422). */
function idOf(raw: string): number {
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2_147_483_647) throw notFound('We cannot find that discount');
  return Number(raw);
}

async function findOr404(db: Db, id: number) {
  const d = await db.discount.findUnique({where: {id}, select: DISCOUNT_SELECT});
  if (!d) throw notFound('We cannot find that discount');
  return d;
}

/** Machine translations of name / label / note, after the response (never delays or fails the save). */
function queueTranslation(c: Context, db: Db, id: number) {
  const work = queueEntityTranslation(db, 'discount', id, {requestUrl: c.req.url}).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (Node tests): the promise runs on its own.
  }
}

// ─── Query schemas ──────────────────────────────────────────────────────────

const STATUS_MESSAGE = 'Use active, scheduled, expired, inactive, used_up';

const listQuery = z.object({
  q: z.string().trim().max(200).optional().default(''),
  method: z.enum(METHODS, {error: 'Use code or automatic'}).optional(),
  status: multiValue(10).pipe(z.array(z.enum(STATUSES, {error: STATUS_MESSAGE}), {error: STATUS_MESSAGE})),
});

const previewQuery = z.object({q: z.string().trim().max(200).optional().default('')});

const namesQuery = z.object({
  kind: z.enum(['product', 'customer'], {error: 'Use product or customer'}),
  ids: z
    .string()
    .optional()
    .default('')
    .transform(s => [...new Set(s.split(',').map(x => x.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(120, 'Use the ids from the list')).max(500, 'Ask for up to 500 names')),
});

const guard = requirePermission(PERMISSIONS.DISCOUNT_MANAGE);

const userSelect = {id: true, name: true, email: true, customerProfile: {select: {firstName: true, lastName: true}}} as const;

type Named = {id: string; name: string};

// ─── Routes ─────────────────────────────────────────────────────────────────

export const discountsAdmin = new Hono()
  .use('*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'private, no-store');
  })

  .get('/', query(listQuery), guard, withDb, async c => {
    const q = c.req.valid('query');
    const db = c.var.db;
    const has = q.q ? {contains: q.q, mode: 'insensitive' as const} : undefined;
    const rows = await db.discount.findMany({
      where: {
        ...(q.method ? {method: q.method} : {}),
        // Unique codes are stored upper case: an upper-cased needle matches them as VAREL's insensitive search did.
        ...(has ? {OR: [{name: has}, {code: has}, {label: has}, {codes: {some: {code: {contains: q.q.toUpperCase()}}}}]} : {}),
      },
      select: DISCOUNT_SELECT,
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      take: 100,
    });
    const all = await serializeMany(db, rows);
    const status: readonly string[] = q.status;
    return c.json(status.length ? all.filter(d => status.includes(d.status)) : all);
  })

  .post('/', json(inputSchema), guard, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    if (input.kind === undefined) throw invalid({kind: 'Choose percent, fixed, shipping or buy X get Y'});
    let s = normalize(overlay(DEFAULTS, input), input);
    await checkTargets(db, s);
    s = await withDefaults(db, s, {label: false, note: false});
    try {
      // The code check and the write run under the codes lock (no unique code can take the same text in between).
      const d = await db.$transaction(
        async tx => {
          await lockCodes(tx);
          await checkCode(tx, s.code);
          return tx.discount.create({data: toColumns(s), select: DISCOUNT_SELECT});
        },
        {timeout: 15_000}
      );
      queueTranslation(c, db, d.id);
      return c.json(await serializeOne(db, d), 201);
    } catch (e) {
      if (errorCode(e) === 'P2002') throw codeTaken();
      throw e;
    }
  })

  .get('/preview', query(previewQuery), guard, withDb, async c => {
    const {q} = c.req.valid('query');
    const db = c.var.db;
    const has = q ? {contains: q, mode: 'insensitive' as const} : undefined;
    const [products, categories, departments, customers] = await Promise.all([
      db.product.findMany({
        where: {status: {in: ['published', 'draft']}, ...(has ? {OR: [{name: has}, {id: has}, {sku: has}]} : {})},
        select: {id: true, name: true, images: {orderBy: {position: 'asc'}, take: 1, select: {src: true}}},
        orderBy: [{position: 'asc'}, {name: 'asc'}],
        take: 20,
      }),
      db.category.findMany({
        where: has ? {OR: [{name: has}, {department: {name: has}}]} : {},
        select: {id: true, name: true, department: {select: {name: true}}},
        orderBy: [{department: {position: 'asc'}}, {position: 'asc'}],
        take: 20,
      }),
      db.department.findMany({where: has ? {name: has} : {}, select: {id: true, name: true}, orderBy: {position: 'asc'}, take: 20}),
      has
        ? db.user.findMany({
            // Customers only: staff and admin accounts aren't offered (nor their emails shown).
            where: {
              ...CUSTOMER_WHERE,
              OR: [{email: has}, {name: has}, {customerProfile: {firstName: has}}, {customerProfile: {lastName: has}}],
            },
            select: userSelect,
            orderBy: {id: 'desc'},
            take: 20,
          })
        : [],
    ]);
    const out: DiscountPreview = {
      products: products.map(p => ({id: p.id, name: p.name, image: p.images[0]?.src ?? null})),
      categories: categories.map(x => ({id: String(x.id), name: x.name, department: x.department.name})),
      departments: departments.map(x => ({id: String(x.id), name: x.name})),
      customers: customers.map(u => ({id: String(u.id), name: displayNameOf(u) || u.email, email: u.email})),
    };
    return c.json(out);
  })

  // Display names for already-chosen products / customers (chips), in one request and within the discounts area.
  .get('/names', query(namesQuery), guard, withDb, async c => {
    const {kind, ids} = c.req.valid('query');
    const db = c.var.db;
    if (!ids.length) return c.json([] as Named[]);
    if (kind === 'product') {
      const rows = await db.product.findMany({where: {id: {in: ids}}, select: {id: true, name: true}});
      return c.json(rows.map((r): Named => ({id: r.id, name: r.name})));
    }
    const ints = intIds(ids);
    if (!ints.length) return c.json([] as Named[]);
    const rows = await db.user.findMany({where: {id: {in: ints}, ...CUSTOMER_WHERE}, select: userSelect});
    return c.json(rows.map((u): Named => ({id: String(u.id), name: displayNameOf(u) || u.email})));
  })

  .get('/:id', guard, withDb, async c => {
    const db = c.var.db;
    return c.json(await serializeOne(db, await findOr404(db, idOf(c.req.param('id')))));
  })

  .patch('/:id', json(inputSchema), guard, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const existing = await findOr404(db, idOf(c.req.param('id')));
    const before = stateOf(existing);
    let s = normalize(overlay(before, input), input);
    // Switching away from unique codes would orphan the generated batch.
    if (
      existing.codeType === 'unique' &&
      s.codeType !== 'unique' &&
      (await db.discountCode.findFirst({where: {discountId: existing.id}, select: {id: true}}))
    ) {
      throw invalid({codeType: 'Delete the unique codes first, or keep unique codes'});
    }
    await checkTargets(db, s, before);
    // Labels/notes that were generated follow rule changes; hand-written ones stay. One name lookup for both.
    const names = await loadTargetNames(db, [before, s]);
    s = await withDefaults(
      db,
      s,
      {
        label: input.label === undefined && before.label === defaultLabel(before, names),
        note: input.note === undefined && before.note === defaultNote(before),
      },
      names
    );
    try {
      const d = await db.$transaction(
        async tx => {
          if (s.code !== existing.code) {
            await lockCodes(tx);
            await checkCode(tx, s.code, existing.id);
          }
          return tx.discount.update({where: {id: existing.id}, data: toColumns(s), select: DISCOUNT_SELECT});
        },
        {timeout: 15_000}
      );
      queueTranslation(c, db, d.id);
      return c.json(await serializeOne(db, d));
    } catch (e) {
      if (errorCode(e) === 'P2002') throw codeTaken();
      throw e;
    }
  })

  .delete('/:id', guard, withDb, async c => {
    const db = c.var.db;
    const d = await findOr404(db, idOf(c.req.param('id')));
    const [redeemed, codeUsed] = await Promise.all([
      db.discountRedemption.findFirst({where: {discountId: d.id}, select: {id: true}}),
      db.discountCode.findFirst({where: {discountId: d.id, OR: [{usedAt: {not: null}}, {orderId: {not: null}}]}, select: {id: true}}),
    ]);
    const deactivate = async () => {
      // Used discounts stay for order history and reports.
      const updated = await db.discount.update({where: {id: d.id}, data: {active: false}, select: DISCOUNT_SELECT});
      return c.json({deactivated: true as const, discount: await serializeOne(db, updated)}, 200);
    };
    if (redeemed || codeUsed) return deactivate();
    try {
      await db.discount.delete({where: {id: d.id}, select: {id: true}}); // unused unique codes cascade
    } catch (e) {
      // An order used it between the check and the delete (redemptions restrict the delete).
      if (errorCode(e) === 'P2003') return deactivate();
      throw e;
    }
    return c.body(null, 204);
  })

  .post('/:id/codes', json(generateSchema), guard, withDb, async c => {
    const created = await generateCodes(c.var.db, idOf(c.req.param('id')), c.req.valid('json'));
    return c.json({created}, 201);
  })

  .get('/:id/codes', query(codesQuerySchema), guard, withDb, async c => {
    return c.json(await listCodes(c.var.db, idOf(c.req.param('id')), c.req.valid('query')));
  })

  .get('/:id/codes.csv', query(codesQuerySchema), guard, withDb, async c => {
    const id = idOf(c.req.param('id'));
    const res = await codesCsv(c.var.db, id, c.req.valid('query'));
    // Codes are bearer secrets: who exported which batch goes in the audit log (new; VAREL kept no record).
    const viewer = (c.var as {viewer?: {state: string; id?: number | null}}).viewer;
    await audit(c.var.db, {
      actorUserId: viewer?.state === 'user' ? (viewer.id ?? null) : null,
      action: 'discount.codes.export',
      target: ['discount', id],
    });
    return res;
  })

  .delete('/:id/codes', guard, withDb, async c => {
    return c.json({deleted: await deleteUnusedCodes(c.var.db, idOf(c.req.param('id')))});
  })

  .get('/:id/report', guard, withDb, async c => {
    return c.json(await discountReport(c.var.db, idOf(c.req.param('id'))));
  });
