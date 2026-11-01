import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** WP-23: `/site-api/manage/shipping`, against Postgres, from the seed's three zones. */
describe.skipIf(!DATABASE_URL)('shipping admin (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  const base = '/site-api/manage/shipping';

  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.41');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.42');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
  }, 120_000);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "shipping_zones", "shipping_methods" CASCADE');
    // As prisma/seed.sql.
    await db.$executeRawUnsafe(`INSERT INTO "shipping_zones" ("id", "name", "position", "countries", "updated_at") VALUES
      ('denmark', 'Denmark', 0, ARRAY['Denmark']::varchar[], now()),
      ('european-union', 'European Union', 1, ARRAY['Germany', 'France', 'Sweden']::varchar[], now()),
      ('rest-of-world', 'Rest of world', 2, '{}'::varchar[], now())`);
    await db.$executeRawUnsafe(`INSERT INTO "shipping_methods" ("id", "zone_id", "name", "detail", "rate_cents", "position", "updated_at") VALUES
      ('denmark-standard', 'denmark', 'Standard', '2–3 days', 0, 0, now()),
      ('denmark-express', 'denmark', 'Express', 'Next day', 1200, 1, now()),
      ('rest-of-world-standard', 'rest-of-world', 'Standard', '6–9 days', 2400, 0, now())`);
  });

  it('lists zones in order with the catch-all and rates in units', async () => {
    const res = await owner.get(base);
    expect(res.status).toBe(200);
    expect(res.json.map((z: {id: string}) => z.id)).toEqual(['denmark', 'european-union', 'rest-of-world']);
    expect(res.json[2]).toMatchObject({zone: 'Rest of world', countries: []});
    expect(res.json[0].methods.map((m: {id: string; rate: number}) => [m.id, m.rate])).toEqual([
      ['denmark-standard', 0],
      ['denmark-express', 12],
    ]);
    expect((await staff.get(base)).status).toBe(200);
  });

  it('one country in one zone', async () => {
    const res = await owner.post(`${base}/zones`, {zone: 'Nordics', countries: ['Norway', 'sweden']});
    expect(res.status).toBe(422);
    expect(res.json.fields['countries.1']).toBe('Sweden is already in European Union');
  });

  it('creates zones with slug ids, next position, and a free id on a repeated name', async () => {
    const res = await owner.post(`${base}/zones`, {zone: 'Nordics', countries: ['Norway', 'Iceland']});
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({id: 'nordics', zone: 'Nordics', countries: ['Norway', 'Iceland'], position: 3, methods: []});
    const again = await owner.post(`${base}/zones`, {zone: 'Nordics', countries: ['Finland']});
    expect(again.json.id).toBe('nordics-2');
  });

  it('keeps exactly one catch-all', async () => {
    const second = await owner.post(`${base}/zones`, {zone: 'Elsewhere', countries: []});
    expect(second.status).toBe(422);
    expect(second.json.fields).toHaveProperty('countries');
    const patch = await owner.request('PATCH', `${base}/zones/rest-of-world`, {countries: ['Japan']});
    expect(patch.status).toBe(409);
    expect(patch.json.error).toBe('last_catch_all');
    expect((await owner.delete(`${base}/zones/rest-of-world`)).status).toBe(409);
  });

  it('methods: slug id, cents, reorder; deleting a zone takes its methods', async () => {
    await owner.post(`${base}/zones`, {zone: 'Nordics', countries: ['Norway']});
    const m = await owner.post(`${base}/zones/nordics/methods`, {name: 'Express', detail: '1–2 days', rate: 12.5});
    expect(m.status).toBe(201);
    expect(m.json).toMatchObject({id: 'nordics-express', rate: 12.5, position: 0});
    expect((await db.shippingMethod.findUniqueOrThrow({where: {id: 'nordics-express'}})).rateCents).toBe(1250);
    const moved = await owner.request('PATCH', `${base}/methods/denmark-express`, {position: 0});
    expect(moved.json.position).toBe(0);
    expect((await owner.delete(`${base}/zones/nordics`)).status).toBe(204);
    expect(await db.shippingMethod.findUnique({where: {id: 'nordics-express'}})).toBeNull();
  });

  it('unknown ids answer 404; too many countries 422; staff cannot write', async () => {
    expect((await owner.request('PATCH', `${base}/zones/nope`, {zone: 'X'})).status).toBe(404);
    expect((await owner.delete(`${base}/zones/nope`)).status).toBe(404);
    expect((await owner.post(`${base}/zones/nope/methods`, {name: 'A', detail: '', rate: 1})).status).toBe(404);
    expect((await owner.request('PATCH', `${base}/methods/nope`, {rate: 1})).status).toBe(404);
    expect((await owner.delete(`${base}/methods/nope`)).status).toBe(404);
    const many = await owner.post(`${base}/zones`, {zone: 'Huge', countries: Array.from({length: 251}, () => 'Norway')});
    expect(many.status).toBe(422);
    expect((await staff.post(`${base}/zones`, {zone: 'Nordics', countries: ['Norway']})).status).toBe(403);
  });
});
