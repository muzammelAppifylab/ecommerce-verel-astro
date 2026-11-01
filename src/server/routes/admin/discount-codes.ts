/* Admin: single-use codes of a `codeType=unique` discount — generate, list, CSV export, delete unused
   (port of VAREL worker/routes/admin/discount-codes.ts). Codes use A–Z and 2–9 without look-alikes (no 0/O/1/I)
   and never collide with other unique codes or shared codes. Lists are keyset pages on (createdAt desc, code asc). */
import {z} from 'zod';

import type {Prisma, PrismaClient} from '../../../generated/prisma/client';
import type {CursorPage} from '../../../lib/types/common';
import type {AdminDiscountCode} from '../../../lib/types/admin/promotions';
import type {Db} from '../../lib/db';
import {HttpError, invalid, notFound} from '../../lib/errors';
import {csvCell, cursorDate, decodeCursor, encodeCursor} from '../../lib/http';
import {slugify} from '../../lib/format';
import {pageQuery} from '../../lib/validate';
import {lockCodes} from './discount-shared';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols: a byte & 31 is unbiased
const CHUNK = 1000;
/** Rows in one CSV export (4 × the largest batch); above it the file is cut and says so (`X-Truncated: 1`). */
export const CSV_MAX_ROWS = 20_000;
const CSV_PAGE = 1000;

export function randomCode(prefix: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = prefix;
  for (const b of bytes) s += CODE_ALPHABET[b & 31];
  return s;
}

export const chunks = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Codes from `candidates` already taken by a unique code or a shared discount code. */
async function taken(db: Db, candidates: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks(candidates)) {
    const [codes, shared] = await Promise.all([
      db.discountCode.findMany({where: {code: {in: part}}, select: {code: true}}),
      db.discount.findMany({where: {code: {in: part}}, select: {code: true}}),
    ]);
    codes.forEach(r => out.add(r.code));
    shared.forEach(r => r.code && out.add(r.code));
  }
  return out;
}

export async function uniqueDiscount(db: Db, id: number) {
  const d = await db.discount.findUnique({where: {id}, select: {id: true, code: true, name: true, codeType: true, method: true}});
  if (!d) throw notFound('We cannot find that discount');
  return d;
}

export const generateSchema = z.object({
  count: z.coerce
    .number({error: 'Enter how many codes to create'})
    .int('Use a whole number')
    .min(1, 'Create at least 1 code')
    .max(5000, 'Create up to 5,000 codes at a time'),
  prefix: z
    .string({error: 'Use letters, numbers and dashes'})
    .trim()
    .toUpperCase()
    // Starts with a letter or number: a leading dash would read as a formula in spreadsheets (and the CSV escapes it).
    .regex(/^([A-Z0-9][A-Z0-9_-]{0,19})?$/, 'Use up to 20 letters, numbers, dashes or underscores, starting with a letter or number')
    .nullish()
    .transform(v => v ?? ''),
  length: z.coerce
    .number({error: 'Use a number'})
    .int('Use a whole number')
    .min(6, 'Use at least 6 characters')
    .max(16, 'Use 16 characters or fewer')
    .optional()
    .default(8),
});
export type GenerateInput = z.output<typeof generateSchema>;

/**
 * Make `count` fresh codes: up to 8 attempts of random batches minus the ones already taken, written in chunks.
 * `isTaken` and `write` are injected so the attempt loop is unit-testable; a short batch throws 409 `codes_exhausted`.
 */
export async function makeCodes(
  input: GenerateInput,
  isTaken: (candidates: string[]) => Promise<Set<string>>,
  write: (codes: string[]) => Promise<number>
): Promise<number> {
  let made = 0;
  for (let attempt = 0; attempt < 8 && made < input.count; attempt++) {
    const need = input.count - made;
    const batch = new Set<string>();
    // A tiny code space (short prefix + length) cannot yield `need` distinct codes: stop drawing after a while.
    for (let tries = 0; batch.size < need && tries < need * 20; tries++) batch.add(randomCode(input.prefix, input.length));
    const clash = await isTaken([...batch]);
    const fresh = [...batch].filter(code => !clash.has(code));
    for (const part of chunks(fresh)) made += await write(part);
  }
  if (made < input.count) {
    throw new HttpError(409, 'CODES_EXHAUSTED', `Only ${made} new codes could be made with that prefix and length. Try a longer code.`, {
      length: 'Use a longer code',
    });
  }
  return made;
}

/** POST /:id/codes — one transaction under the codes lock: no shared code can take a generated text meanwhile,
    and a batch that can't be completed writes nothing. */
export async function generateCodes(db: PrismaClient, id: number, input: GenerateInput): Promise<number> {
  const d = await uniqueDiscount(db, id);
  if (d.method !== 'code' || d.codeType !== 'unique') throw invalid({codeType: 'Codes can only be generated for a unique-code discount'});
  return db.$transaction(
    async tx => {
      await lockCodes(tx);
      return makeCodes(
        input,
        candidates => taken(tx, candidates),
        async part => (await tx.discountCode.createMany({data: part.map(code => ({discountId: d.id, code})), skipDuplicates: true})).count
      );
    },
    {timeout: 30_000}
  );
}

export const codesQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  used: z.enum(['true', 'false'], {error: 'Use true or false'}).optional(),
  ...pageQuery,
});
export type CodesQuery = z.output<typeof codesQuerySchema>;

const UNUSED = {usedAt: null, orderId: null} satisfies Prisma.DiscountCodeWhereInput;

export function codesWhere(discountId: number, q: Pick<CodesQuery, 'q' | 'used'>): Prisma.DiscountCodeWhereInput {
  return {
    discountId,
    // Codes are stored upper case: an upper-cased needle matches as VAREL's case-insensitive search did.
    ...(q.q
      ? {OR: [{code: {contains: q.q.toUpperCase()}}, {order: {number: {contains: q.q, mode: 'insensitive' as const}}}]}
      : {}),
    // A code is used once it has a use date or an order (the same rule as "Delete unused" and the counts).
    ...(q.used === 'true' ? {NOT: UNUSED} : q.used === 'false' ? UNUSED : {}),
  };
}

const codeSelect = {id: true, code: true, usedAt: true, createdAt: true, order: {select: {number: true}}} as const;
const codeOrder: Prisma.DiscountCodeOrderByWithRelationInput[] = [{createdAt: 'desc'}, {code: 'asc'}];
type CodeRow = Prisma.DiscountCodeGetPayload<{select: typeof codeSelect}>;

/** Rows after the cursor's row in (createdAt desc, code asc) order. */
function after(cursor: string | undefined): Prisma.DiscountCodeWhereInput {
  const values = decodeCursor(cursor, 2);
  const at = cursorDate(values?.[0]);
  const code = values?.[1];
  if (!at || typeof code !== 'string') return {};
  return {OR: [{createdAt: {lt: at}}, {createdAt: at, code: {gt: code}}]};
}

const adminCode = (r: CodeRow): AdminDiscountCode => ({
  id: String(r.id),
  code: r.code,
  usedAt: r.usedAt ? r.usedAt.toISOString() : null,
  orderNumber: r.order?.number ?? null,
  createdAt: r.createdAt.toISOString(),
});

/** GET /:id/codes — one keyset page (default 25, ≤ 100). */
export async function listCodes(db: Db, id: number, q: CodesQuery): Promise<CursorPage<AdminDiscountCode>> {
  const d = await uniqueDiscount(db, id);
  const size = q.pageSize ?? 25;
  const rows = await db.discountCode.findMany({
    where: {AND: [codesWhere(d.id, q), after(q.cursor)]},
    select: codeSelect,
    orderBy: codeOrder,
    take: size + 1,
  });
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return {
    items: items.map(adminCode),
    nextCursor: rows.length > size && last ? encodeCursor([last.createdAt, last.code]) : null,
  };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** GET /:id/codes.csv — streamed in keyset pages of 1,000, at most `CSV_MAX_ROWS` rows. */
export async function codesCsv(db: Db, id: number, q: CodesQuery): Promise<Response> {
  const d = await uniqueDiscount(db, id);
  const where = codesWhere(d.id, q);
  const slug = slugify(d.name || d.code || 'discount') || 'discount';
  const filename = `varel-${slug}-codes-${isoDate(new Date())}.csv`.replace(/[^\w.-]+/g, '-');
  // Read the first page (and whether the cap cuts the file) before answering, so a database error is a proper
  // error response, not a cut file. The probe reads one row past the cap: bounded, in index order.
  const [first, beyond] = await Promise.all([
    db.discountCode.findMany({where, select: codeSelect, orderBy: codeOrder, take: CSV_PAGE + 1}),
    db.discountCode.findFirst({where, select: {id: true}, orderBy: codeOrder, skip: CSV_MAX_ROWS}),
  ]);
  const line = (r: CodeRow) => [r.code, r.usedAt || r.order ? 'yes' : 'no', r.usedAt, r.order?.number ?? ''].map(csvCell).join(',') + '\r\n';
  const encoder = new TextEncoder();
  let page = first;
  let written = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(['Code', 'Used', 'Used at', 'Order'].map(csvCell).join(',') + '\r\n'));
    },
    async pull(controller) {
      try {
        const rows = page.slice(0, CSV_PAGE);
        const take = rows.slice(0, CSV_MAX_ROWS - written);
        if (take.length) controller.enqueue(encoder.encode(take.map(line).join('')));
        written += take.length;
        const last = rows.at(-1);
        if (page.length <= CSV_PAGE || written >= CSV_MAX_ROWS || !last) {
          controller.close();
          return;
        }
        page = await db.discountCode.findMany({
          where: {AND: [where, {OR: [{createdAt: {lt: last.createdAt}}, {createdAt: last.createdAt, code: {gt: last.code}}]}]},
          select: codeSelect,
          orderBy: codeOrder,
          take: CSV_PAGE + 1,
        });
      } catch (err) {
        controller.error(err);
      }
    },
  });
  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  };
  if (beyond) headers['X-Truncated'] = '1';
  return new Response(stream, {status: 200, headers});
}

/** DELETE /:id/codes — the unused codes only (used ones stay for order history). */
export async function deleteUnusedCodes(db: Db, id: number): Promise<number> {
  const d = await uniqueDiscount(db, id);
  const r = await db.discountCode.deleteMany({where: {discountId: d.id, ...UNUSED}});
  return r.count;
}
