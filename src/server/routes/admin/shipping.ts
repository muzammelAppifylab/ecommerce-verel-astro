import {Hono} from 'hono';
import {z} from 'zod';

import type {Prisma} from '../../../generated/prisma/client';
import type {AdminShippingMethod, AdminShippingZone} from '../../../lib/types/admin/store';
import {requirePermission, withDb} from '../../../platform/guards';
import {canonicalCountry, isKnownCountry} from '../../lib/countries';
import type {Db} from '../../lib/db';
import {conflict, invalid, notFound} from '../../lib/errors';
import {slugify} from '../../lib/format';
import {fromCents, round2, toCents} from '../../lib/money';
import {json} from '../../lib/validate';
import {PERMISSIONS} from '../../permissions';

/**
 * Admin: shipping zones and methods (port of VAREL worker/routes/admin/shipping.ts).
 *
 *   GET    /site-api/manage/shipping                   AdminShippingZone[]
 *   POST   /site-api/manage/shipping/zones             ZoneInput → 201 AdminShippingZone
 *   PATCH  /site-api/manage/shipping/zones/:id         Partial<ZoneInput> → AdminShippingZone; 409 last_catch_all
 *   DELETE /site-api/manage/shipping/zones/:id         204 (its methods go with it); 409 last_catch_all
 *   POST   /site-api/manage/shipping/zones/:id/methods MethodInput → 201 AdminShippingMethod
 *   PATCH  /site-api/manage/shipping/methods/:id       Partial<MethodInput> → AdminShippingMethod
 *   DELETE /site-api/manage/shipping/methods/:id       204
 *
 * Guarded centrally (src/server/routes/admin/index.ts): reads any staff, writes the settings area; writes
 * add `requirePermission(STORE_SETTINGS_MANAGE)`.
 *
 * Rules: one country belongs to one zone; exactly one catch-all zone (no countries) remains. Zone and method
 * ids are slugs made once from the name and never change (checkout and bags carry them). Zones are store
 * config (a handful of rows): lists read at most 100 zones of at most 100 methods, never paged.
 */

const ZONE_LIMIT = 100;
const METHOD_LIMIT = 100;
const ID_RE = /^[a-z0-9-]{1,160}$/;

const methodSelect = {id: true, name: true, detail: true, rateCents: true, position: true} as const;
const zoneSelect = {
  id: true,
  name: true,
  countries: true,
  position: true,
  methods: {select: methodSelect, orderBy: [{position: 'asc'}, {id: 'asc'}], take: METHOD_LIMIT},
} as const satisfies Prisma.ShippingZoneSelect;

type ZoneRow = Prisma.ShippingZoneGetPayload<{select: typeof zoneSelect}>;
type MethodRow = Prisma.ShippingMethodGetPayload<{select: typeof methodSelect}>;

export const adminMethod = (m: MethodRow): AdminShippingMethod => ({
  id: m.id,
  name: m.name,
  detail: m.detail,
  rate: fromCents(m.rateCents),
  position: m.position,
});

export const adminZone = (z: ZoneRow): AdminShippingZone => ({
  id: z.id,
  zone: z.name,
  countries: z.countries,
  position: z.position,
  methods: z.methods.map(adminMethod),
});

const text = (label: string, max: number) =>
  z.string({error: `Enter ${label}`}).trim().min(1, `Enter ${label}`).max(max, `Keep ${label} under ${max} characters`);
const positionField = z.coerce.number({error: 'Use a number'}).int('Use a whole number').min(0, 'Use zero or more').max(10_000, 'Use 10000 or less');

const countriesField = z
  .array(z.string({error: 'Choose a country'}).trim().min(1, 'Choose a country').max(80, 'Choose a country we ship to'), {
    error: 'Use a list of countries',
  })
  .max(250, 'Keep it to 250 countries or fewer')
  .superRefine((list, ctx) => {
    list.forEach((c, i) => {
      if (!isKnownCountry(c)) ctx.addIssue({code: 'custom', path: [i], message: `${c} is not a country we ship to`});
    });
  })
  .transform(list => Array.from(new Set(list.map(canonicalCountry))));

export const zoneCreate = z.object({zone: text('a zone name', 80), countries: countriesField, position: positionField.optional()});
export const zonePatch = zoneCreate.partial();

export const methodCreate = z.object({
  name: text('a method name', 60),
  detail: z.string({error: 'Enter a delivery time'}).trim().max(80, 'Keep this under 80 characters'),
  rate: z.coerce.number({error: 'Enter a rate'}).min(0, 'Use zero or more').max(10_000, 'Use 10000 or less').transform(round2),
  position: positionField.optional(),
});
export const methodPatch = methodCreate.partial();

type Tx = Db;

const zoneMissing = () => notFound('We cannot find that shipping zone');
const methodMissing = () => notFound('We cannot find that shipping method');

const allZones = (db: Tx) =>
  db.shippingZone.findMany({select: {id: true, name: true, countries: true}, orderBy: [{position: 'asc'}, {name: 'asc'}], take: ZONE_LIMIT});

async function loadZone(db: Tx, id: string): Promise<ZoneRow> {
  if (!ID_RE.test(id)) throw zoneMissing();
  const zone = await db.shippingZone.findUnique({where: {id}, select: zoneSelect});
  if (!zone) throw zoneMissing();
  return zone;
}

/** A country belongs to one zone; only one zone can be the catch-all (no countries). */
async function checkCountries(db: Tx, zoneId: string | null, countries: string[]) {
  const others = (await allZones(db)).filter(z => z.id !== zoneId);
  const fields: Record<string, string> = {};
  countries.forEach((c, i) => {
    const owner = others.find(z => z.countries.includes(c));
    if (owner) fields[`countries.${i}`] = `${c} is already in ${owner.name}`;
  });
  if (!countries.length && others.some(z => z.countries.length === 0)) {
    fields.countries = 'Another zone already covers the rest of the world. Add countries to this one';
  }
  if (Object.keys(fields).length) throw invalid(fields);
}

/** True when the zone is the only catch-all left. */
async function isLastCatchAll(db: Tx, zoneId: string) {
  const others = await db.shippingZone.findFirst({where: {id: {not: zoneId}, countries: {isEmpty: true}}, select: {id: true}});
  return !others;
}

/** `root`, or `root-2`, `root-3`… — the first id not in `taken` (one bounded read, not a query per try). */
export function freeId(root: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) if (!used.has(`${root}-${n}`)) return `${root}-${n}`;
}

const zoneRoot = (name: string) => (slugify(name) || 'zone').slice(0, 72).replace(/-+$/, '') || 'zone';
const methodRoot = (zoneId: string, name: string) =>
  `${zoneId}-${slugify(name) || 'method'}`.slice(0, 150).replace(/-+$/, '');

const write = requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE);

export const shippingAdmin = new Hono()
  .get('/', withDb, async c => {
    c.header('Cache-Control', 'private, no-store');
    const zones = await c.var.db.shippingZone.findMany({select: zoneSelect, orderBy: [{position: 'asc'}, {name: 'asc'}], take: ZONE_LIMIT});
    return c.json(zones.map(adminZone));
  })
  .post('/zones', json(zoneCreate), write, withDb, async c => {
    const input = c.req.valid('json');
    const zone = await c.var.db.$transaction(async tx => {
      await checkCountries(tx, null, input.countries);
      const root = zoneRoot(input.zone);
      const [taken, max] = await Promise.all([
        tx.shippingZone.findMany({where: {id: {startsWith: root}}, select: {id: true}, take: 100}),
        tx.shippingZone.aggregate({_max: {position: true}}),
      ]);
      const id = freeId(root, taken.map(t => t.id));
      return tx.shippingZone.create({
        data: {id, name: input.zone, countries: input.countries, position: input.position ?? (max._max.position ?? -1) + 1},
        select: zoneSelect,
      });
    });
    return c.json(adminZone(zone), 201);
  })
  .patch('/zones/:id', json(zonePatch), write, withDb, async c => {
    const input = c.req.valid('json');
    const zone = await c.var.db.$transaction(async tx => {
      const current = await loadZone(tx, c.req.param('id'));
      if (input.countries) {
        if (current.countries.length === 0 && input.countries.length > 0 && (await isLastCatchAll(tx, current.id))) {
          throw conflict('LAST_CATCH_ALL', 'Keep one zone without countries so every address can be shipped to');
        }
        await checkCountries(tx, current.id, input.countries);
      }
      return tx.shippingZone.update({
        where: {id: current.id},
        data: {name: input.zone, countries: input.countries, position: input.position},
        select: zoneSelect,
      });
    });
    return c.json(adminZone(zone));
  })
  .delete('/zones/:id', write, withDb, async c => {
    const db = c.var.db;
    const id = c.req.param('id');
    if (!ID_RE.test(id)) throw zoneMissing();
    const zone = await db.shippingZone.findUnique({where: {id}, select: {id: true, countries: true}});
    if (!zone) throw zoneMissing();
    if (zone.countries.length === 0 && (await isLastCatchAll(db, zone.id))) {
      throw conflict('LAST_CATCH_ALL', 'This zone covers the rest of the world and cannot be deleted');
    }
    await db.shippingZone.delete({where: {id: zone.id}});
    return c.body(null, 204);
  })
  .post('/zones/:id/methods', json(methodCreate), write, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const zoneId = c.req.param('id');
    if (!ID_RE.test(zoneId)) throw zoneMissing();
    const zone = await db.shippingZone.findUnique({where: {id: zoneId}, select: {id: true}});
    if (!zone) throw zoneMissing();
    const root = methodRoot(zone.id, input.name);
    const [taken, max] = await Promise.all([
      db.shippingMethod.findMany({where: {id: {startsWith: root}}, select: {id: true}, take: 100}),
      db.shippingMethod.aggregate({where: {zoneId: zone.id}, _max: {position: true}}),
    ]);
    const method = await db.shippingMethod.create({
      data: {
        id: freeId(root, taken.map(t => t.id)),
        zoneId: zone.id,
        name: input.name,
        detail: input.detail,
        rateCents: toCents(input.rate),
        position: input.position ?? (max._max.position ?? -1) + 1,
      },
      select: methodSelect,
    });
    return c.json(adminMethod(method), 201);
  })
  .patch('/methods/:id', json(methodPatch), write, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const id = c.req.param('id');
    if (!ID_RE.test(id)) throw methodMissing();
    const existing = await db.shippingMethod.findUnique({where: {id}, select: {id: true}});
    if (!existing) throw methodMissing();
    const method = await db.shippingMethod.update({
      where: {id: existing.id},
      data: {
        name: input.name,
        detail: input.detail,
        rateCents: input.rate === undefined ? undefined : toCents(input.rate),
        position: input.position,
      },
      select: methodSelect,
    });
    return c.json(adminMethod(method));
  })
  .delete('/methods/:id', write, withDb, async c => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) throw methodMissing();
    const {count} = await c.var.db.shippingMethod.deleteMany({where: {id}});
    if (!count) throw methodMissing();
    return c.body(null, 204);
  });
