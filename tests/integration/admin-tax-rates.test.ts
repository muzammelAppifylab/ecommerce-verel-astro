import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** WP-23: `/site-api/manage/tax-rates`, against Postgres. */
describe.skipIf(!DATABASE_URL)('tax rates admin (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  const base = '/site-api/manage/tax-rates';

  beforeAll(async () => {
    configureEnv();
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.32');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
  }, 120_000);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "tax_rates" RESTART IDENTITY');
  });

  it('creates a rate with a canonical country, a default name and a string id', async () => {
    const res = await owner.post(base, {country: 'denmark', rate: 0.25});
    expect(res.status).toBe(201);
    expect(res.json).toEqual({id: expect.any(String), country: 'Denmark', rate: 0.25, name: 'VAT'});
    const again = await owner.post(base, {country: 'Denmark', rate: 0.2});
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('country_taken');
    expect(again.json.fields).toHaveProperty('country');
  });

  it('refuses an unknown country and a rate above 1', async () => {
    const res = await owner.post(base, {country: 'Atlantis', rate: 0.1});
    expect(res.status).toBe(422);
    expect(res.json.fields).toHaveProperty('country');
    expect((await owner.post(base, {country: 'Germany', rate: 1.5})).status).toBe(422);
  });

  it('lists sorted by country; PATCH to a taken country answers 409', async () => {
    await owner.post(base, {country: 'Sweden', rate: 0.25});
    const de = (await owner.post(base, {country: 'Germany', rate: 0.19})).json;
    const list = await owner.get(base);
    expect(list.status).toBe(200);
    expect(list.json.map((r: {country: string}) => r.country)).toEqual(['Germany', 'Sweden']);
    expect((await owner.request('PATCH', `${base}/${de.id}`, {country: 'sweden'})).status).toBe(409);
    const renamed = await owner.request('PATCH', `${base}/${de.id}`, {rate: 0.07, name: 'MwSt'});
    expect(renamed.json).toMatchObject({country: 'Germany', rate: 0.07, name: 'MwSt'});
  });

  it('unknown or malformed ids answer 404; DELETE answers 204', async () => {
    const r = (await owner.post(base, {country: 'France', rate: 0.2})).json;
    expect((await owner.request('PATCH', `${base}/abc`, {rate: 0.1})).status).toBe(404);
    expect((await owner.request('PATCH', `${base}/9999`, {rate: 0.1})).status).toBe(404);
    expect((await owner.delete(`${base}/abc`)).status).toBe(404);
    expect((await owner.delete(`${base}/${r.id}`)).status).toBe(204);
    expect((await owner.delete(`${base}/${r.id}`)).status).toBe(404);
  });

  it('staff without the settings permission read but cannot write', async () => {
    expect((await staff.get(base)).status).toBe(200);
    expect((await staff.post(base, {country: 'Spain', rate: 0.21})).status).toBe(403);
  });
});
