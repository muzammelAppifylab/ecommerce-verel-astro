import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const sent = vi.hoisted(() => [] as {key: string; to: string}[]);
vi.mock('../../src/server/lib/contracts', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/server/lib/contracts')>();
  return {
    ...real,
    sendTemplate: async (_db: unknown, key: string, to: string) => {
      sent.push({key, to});
    },
  };
});

import {DontRetry} from '../../src/platform/background';
import {remindAbandonedCarts, REMIND_PER_RUN, runAbandonedReminders} from '../../src/server/jobs/abandoned-carts';
import {abandonedInclude, sendReminder} from '../../src/server/lib/abandoned';
import {env} from './support/cloudflare-workers';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';
import {bagFixture, catalogFixture, HOUR} from './support/abandoned-fixtures';

const ctx = {origin: 'https://shop.example.test', secret: 'integration-test-secret-0123456789-abcdefghijklmnop'};
const job = {id: 'local_1', list: 'abandoned-carts', attempt: 1, maxAttempts: 3, scheduledFor: new Date().toISOString(), group: null, local: true};

/** The `abandoned-carts` job (WP-24) against Postgres. */
describe.skipIf(!DATABASE_URL)('abandoned-carts job (integration)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    sent.length = 0;
    await catalogFixture();
  });

  it('does nothing while the setting is off', async () => {
    await bagFixture({email: 'a@example.com', updatedAgo: 30, lineAgo: [30]});
    expect(await runAbandonedReminders(db, ctx)).toMatchObject({enabled: false, checked: 0, sent: 0});
    expect(sent).toHaveLength(0);
  });

  it('reminds idle, unreminded, undismissed, newest-per-shopper bags, oldest first, capped per run', async () => {
    await db.setting.update({where: {id: 1}, data: {abandonedCartEnabled: true, abandonedCartHours: 24}});
    await bagFixture({email: 'fresh@example.com', updatedAgo: 2, lineAgo: [2]});
    await bagFixture({email: 'done@example.com', updatedAgo: 40, lineAgo: [40], reminderAgo: 30});
    await bagFixture({email: 'gone@example.com', updatedAgo: 40, lineAgo: [40], dismissedAgo: 30});
    await bagFixture({email: 'twice@example.com', updatedAgo: 90, lineAgo: [90]});
    await bagFixture({email: 'twice@example.com', updatedAgo: 5, lineAgo: [5]});
    for (let i = 0; i < REMIND_PER_RUN + 2; i++) await bagFixture({email: `idle${i}@example.com`, updatedAgo: 100 - i, lineAgo: [100 - i]});

    const first = await runAbandonedReminders(db, ctx);
    expect(first.sent).toBe(REMIND_PER_RUN);
    expect(sent.map(s => s.to)).toEqual(Array.from({length: REMIND_PER_RUN}, (_, i) => `idle${i}@example.com`));
    expect(first.outcomes).toMatchObject({sent: REMIND_PER_RUN});

    sent.length = 0;
    const second = await runAbandonedReminders(db, ctx);
    // The two idle bags left; the older twice@ bag is superseded; nothing else is due.
    expect(sent.map(s => s.to)).toEqual([`idle${REMIND_PER_RUN}@example.com`, `idle${REMIND_PER_RUN + 1}@example.com`]);
    expect(second.outcomes).toMatchObject({superseded: 1, sent: 2});

    sent.length = 0;
    expect((await runAbandonedReminders(db, ctx)).sent).toBe(0);
  });

  it('a piece added after a reminder makes the bag due again once idle', async () => {
    await db.setting.update({where: {id: 1}, data: {abandonedCartEnabled: true, abandonedCartHours: 24}});
    const id = await bagFixture({email: 'back@example.com', updatedAgo: 50, lineAgo: [50, 30], reminderAgo: 40});
    expect((await runAbandonedReminders(db, ctx)).sent).toBe(1);
    expect(sent).toEqual([{key: 'abandoned_cart', to: 'back@example.com'}]);
    expect((await db.cart.findUniqueOrThrow({where: {id}})).reminderSentAt!.getTime()).toBeGreaterThan(Date.now() - HOUR);
  });

  it('a bag beyond the 500 most recently active is still reminded', async () => {
    await db.setting.update({where: {id: 1}, data: {abandonedCartEnabled: true, abandonedCartHours: 24}});
    const old = await bagFixture({email: 'ancient@example.com', updatedAgo: 900, lineAgo: [900]});
    await db.$executeRaw`INSERT INTO "carts" ("email", "created_at", "updated_at") SELECT 'n' || g || '@example.com', now(), now() FROM generate_series(1, 510) g`;
    await db.$executeRaw`INSERT INTO "cart_lines" ("cart_id", "product_id", "variant_id", "qty", "created_at", "updated_at")
      SELECT id, 'wool-coat', 'wool-coat-stone-m', 1, now(), now() FROM "carts" WHERE "id" <> ${old}`;
    await runAbandonedReminders(db, ctx);
    expect(sent.map(s => s.to)).toEqual(['ancient@example.com']);
  });

  it('two overlapping sends with the same snapshot send once', async () => {
    const id = await bagFixture({email: 'race@example.com', updatedAgo: 30, lineAgo: [30]});
    const cart = await db.cart.findUniqueOrThrow({where: {id}, include: abandonedInclude});
    const outcomes = await Promise.all([sendReminder({db, ...ctx}, cart), sendReminder({db, ...ctx}, cart)]);
    expect(outcomes.sort()).toEqual(['already-sent', 'sent']);
    expect(sent).toHaveLength(1);
  });

  it('the scheduled handler refuses without a site address', async () => {
    const saved = env.SITE_URL;
    env.SITE_URL = '';
    try {
      await expect(remindAbandonedCarts({}, job)).rejects.toBeInstanceOf(DontRetry);
    } finally {
      env.SITE_URL = saved;
    }
  });
});
