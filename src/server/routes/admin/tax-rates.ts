import {Hono} from 'hono';
import {z} from 'zod';

import {requirePermission, withDb} from '../../../platform/guards';
import {canonicalCountry, isKnownCountry} from '../../lib/countries';
import {conflict, notFound} from '../../lib/errors';
import {serializeTaxRate} from '../../lib/settings';
import {json} from '../../lib/validate';
import {PERMISSIONS} from '../../permissions';

/**
 * Admin: country tax rates (port of VAREL worker/routes/admin/tax-rates.ts). Checkout picks the rate by
 * the shipping country (case-insensitive match, F4 `taxFor`), falling back to `Setting.taxRate`.
 *
 *   GET    /site-api/manage/tax-rates                  AdminTaxRate[] (sorted by country; ≤ 100, one per country)
 *   POST   /site-api/manage/tax-rates                  TaxRateInput → 201 AdminTaxRate; 409 country_taken
 *   PATCH  /site-api/manage/tax-rates/:id              Partial<TaxRateInput> → AdminTaxRate; 409 country_taken
 *   DELETE /site-api/manage/tax-rates/:id              204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): reads any staff, writes the settings area; writes
 * add `requirePermission(STORE_SETTINGS_MANAGE)`. Ids are Int in the database, strings on the wire; an id
 * that is not a positive integer answers 404 (as VAREL did for unknown ids), never 422.
 */

const LIST_LIMIT = 100;
const select = {id: true, country: true, rate: true, name: true} as const;
/** F4's `serializeTaxRate` reads only these four fields; its parameter type asks for the whole row. */
type TaxRateRow = Parameters<typeof serializeTaxRate>[0];
const serialize = (r: Pick<TaxRateRow, 'id' | 'country' | 'rate' | 'name'>) => serializeTaxRate(r as TaxRateRow);

const taxRateFields = {
  country: z
    .string({error: 'Choose a country'})
    .trim()
    .min(1, 'Choose a country')
    .max(80, 'Choose a country we ship to')
    .refine(isKnownCountry, 'Choose a country we ship to')
    .transform(canonicalCountry),
  rate: z.coerce
    .number({error: 'Enter a tax rate'})
    .min(0, 'Use zero or more')
    .max(1, 'Use a fraction such as 0.25 for 25%')
    .transform(r => Math.round(r * 10_000) / 10_000),
  name: z
    .string({error: 'Enter a tax name, e.g. VAT'})
    .trim()
    .min(1, 'Enter a tax name, e.g. VAT')
    .max(40, 'Keep the tax name under 40 characters'),
};

export const taxRateInput = z.object({...taxRateFields, name: taxRateFields.name.optional().default('VAT')});
export const taxRatePatch = z.object(taxRateFields).partial();

const taken = (country: string) =>
  conflict('COUNTRY_TAKEN', `${country} already has a tax rate`, {country: `${country} already has a tax rate`});
const missing = () => notFound('We cannot find that tax rate');

/** The numeric id of a path param, or null when it cannot be one (answers 404). */
function idOf(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

const isUniqueViolation = (err: unknown) =>
  !!err && typeof err === 'object' && (err as {code?: unknown}).code === 'P2002';

export const taxRatesAdmin = new Hono()
  .get('/', withDb, async c => {
    c.header('Cache-Control', 'private, no-store');
    const rows = await c.var.db.taxRate.findMany({select, orderBy: {country: 'asc'}, take: LIST_LIMIT});
    return c.json(rows.map(serialize));
  })
  .post('/', json(taxRateInput), requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE), withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    if (await db.taxRate.findUnique({where: {country: input.country}, select: {id: true}})) throw taken(input.country);
    try {
      const row = await db.taxRate.create({data: input, select});
      return c.json(serialize(row), 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw taken(input.country); // a parallel create won the race
      throw err;
    }
  })
  .patch('/:id', json(taxRatePatch), requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE), withDb, async c => {
    const id = idOf(c.req.param('id'));
    if (id === null) throw missing();
    const input = c.req.valid('json');
    const db = c.var.db;
    const existing = await db.taxRate.findUnique({where: {id}, select: {id: true, country: true}});
    if (!existing) throw missing();
    try {
      const row = await db.taxRate.update({where: {id}, data: input, select});
      return c.json(serialize(row));
    } catch (err) {
      if (isUniqueViolation(err)) throw taken(input.country ?? existing.country);
      throw err;
    }
  })
  .delete('/:id', requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE), withDb, async c => {
    const id = idOf(c.req.param('id'));
    if (id === null) throw missing();
    const {count} = await c.var.db.taxRate.deleteMany({where: {id}});
    if (!count) throw missing();
    return c.body(null, 204);
  });
