import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

type Page = {
  items: {id: string; at: string; actor: {id: string | null; name: string}; entity: string; summary: string}[];
  nextCursor: string | null;
  actors: {id: string; name: string}[];
  entities: string[];
};

/** `/site-api/manage/activity` (WP-26): keyset list, filters, CSV export. */
describe.skipIf(!DATABASE_URL)('manage activity (integration, real Postgres)', () => {
  let owner: Browser;
  let customer: Browser;
  let ownerId: number;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.32');
    ownerId = await userId('owner@example.test');
    const customerId = await userId('customer@example.test');
    // 120 rows: 3 actors (one without an account), 4 entities, one per minute from 2026-10-01 00:00 UTC.
    const entities = ['product', 'order', 'discount', 'settings'];
    const start = Date.UTC(2026, 9, 1);
    await db.activityLog.createMany({
      data: Array.from({length: 120}, (_, i) => ({
        userId: i % 3 === 0 ? ownerId : i % 3 === 1 ? customerId : null,
        actorName: i % 3 === 0 ? 'Old owner name' : i % 3 === 1 ? 'customer' : 'System',
        action: `${entities[i % 4]}.update`,
        entity: entities[i % 4]!,
        entityId: String(i),
        summary: i === 7 ? '-5 stock for Atelier Wool Coat' : `Updated ${entities[i % 4]} number ${i}`,
        // Two days: rows 0–59 on Oct 1, rows 60–119 on Oct 2.
        createdAt: new Date(start + (i < 60 ? i : 1440 + i) * 60_000),
      })),
    });
  }, 120_000);

  it('only the staff area reads it', async () => {
    expect((await customer.get('/site-api/manage/activity')).status).toBe(403);
    expect((await customer.get('/site-api/manage/activity/export.csv')).status).toBe(403);
    expect((await new Browser(app).get('/site-api/manage/activity')).status).toBe(401);
  });

  it('pages newest first with a cursor chain, filter choices on page 1 only', async () => {
    const seen: string[] = [];
    let cursor = '';
    let first: Page | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await owner.get(`/site-api/manage/activity?pageSize=50${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
      const page = res.json as unknown as Page;
      if (!first) first = page;
      else expect(page.actors).toEqual([]);
      seen.push(...page.items.map(r => r.id));
      if (!page.nextCursor) break;
      cursor = encodeURIComponent(page.nextCursor);
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    const ats = first!.items.map(r => r.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    // Current names win over the snapshot.
    expect(first!.actors.map(a => a.name).sort()).toEqual(['customer', 'owner']);
    expect(first!.entities).toEqual(['discount', 'order', 'product', 'settings']);
  });

  it('filters by actor, type, dates (to is inclusive) and every search word', async () => {
    const get = async (q: string) => (await owner.get(`/site-api/manage/activity?pageSize=100&${q}`)).json as unknown as Page;
    expect((await get(`actor=${ownerId}`)).items).toHaveLength(40);
    expect((await get('entity=order')).items.every(r => r.entity === 'order')).toBe(true);
    expect((await get('from=2026-10-02')).items).toHaveLength(60);
    expect((await get('to=2026-10-01')).items).toHaveLength(60);
    expect((await get('from=2026-10-01&to=2026-10-01&entity=product')).items).toHaveLength(15);
    expect((await get('q=atelier%20COAT')).items.map(r => r.summary)).toEqual(['-5 stock for Atelier Wool Coat']);
    expect((await get('q=updated%20owner')).items).toHaveLength(40); // 'owner' matches the actor name snapshot
    expect((await get('actor=999999')).items).toHaveLength(0);
  });

  it('answers 422 for bad filters', async () => {
    const actor = await owner.get('/site-api/manage/activity?actor=abc');
    expect(actor.status).toBe(422);
    expect(actor.json).toMatchObject({fields: {actor: 'Choose someone from the list'}});
    expect((await owner.get('/site-api/manage/activity?from=nope')).json).toMatchObject({fields: {from: 'Use a date such as 2026-10-01'}});
    expect((await owner.get('/site-api/manage/activity?pageSize=500')).status).toBe(422);
    expect((await owner.get(`/site-api/manage/activity?q=${'x'.repeat(201)}`)).status).toBe(422);
  });

  it('exports the filtered rows as CSV and records the export', async () => {
    const res = await owner.get('/site-api/manage/activity/export.csv?entity=product');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="varel-activity-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get('cache-control')).toContain('private');
    const text = String(res.json.text);
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('Date,Staff,Action,Entity,Entity id,Summary');
    expect(lines).toHaveLength(31);
    expect(lines[1]).toMatch(/^2026-10-02T/);
    const audit = await db.auditEvent.findFirst({where: {action: 'activity_exported'}});
    expect(audit).toMatchObject({actorUserId: ownerId, targetType: 'activity_log'});
    expect(audit?.meta).toEqual({filters: ['entity']});
  });

  it('guards spreadsheet formulas in the CSV', async () => {
    const res = await owner.get('/site-api/manage/activity/export.csv?q=atelier');
    const lines = String(res.json.text).split('\r\n').filter(Boolean);
    expect(lines[1]).toContain(",'-5 stock for Atelier Wool Coat");
  });
});
