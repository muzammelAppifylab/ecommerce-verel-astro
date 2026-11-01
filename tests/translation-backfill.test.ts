/* Backfill (WP-25; VAREL worker/lib/i18n/backfill.ts): grouped per record, bounded by `limit`, `maxCalls` and
   `budgetMs`, what is not done counts as remaining. Sources are faked (three products). */
import assert from 'node:assert/strict';
import {describe, it, vi} from 'vitest';

import {runBackfill} from '../src/server/lib/i18n/backfill';
import {mockProvider} from '../src/server/lib/i18n/providers/mock';
import {cfg as baseCfg, fakeDb} from './translation-helpers';

vi.mock('../src/server/lib/i18n/sources', async importOriginal => {
  const real = await importOriginal<typeof import('../src/server/lib/i18n/sources')>();
  const products = ['a', 'b', 'c'].map(id => ({id, label: `Product ${id}`, fields: {name: `Name ${id}`, short: `Short ${id}`}}));
  return {
    ...real,
    loadSources: vi.fn(async (_db: unknown, entity: string, ids?: string[]) =>
      entity === 'product' ? products.filter(p => !ids || ids.includes(p.id)) : []
    ),
  };
});

const cfg = {...baseCfg, locales: ['en', 'da', 'de']};

describe('runBackfill', () => {
  it('fills every missing translation, then has nothing left', async () => {
    const {db, rows} = fakeDb();
    const r = await runBackfill(db, cfg, {provider: mockProvider()});
    assert.deepEqual(r, {translated: 12, failed: 0, remaining: 0});
    assert.equal(rows.length, 12);
    assert.deepEqual(await runBackfill(db, cfg, {provider: mockProvider()}), {translated: 0, failed: 0, remaining: 0});
  });

  it('stops starting records at the limit; the rest is remaining', async () => {
    const {db} = fakeDb();
    // 4 field-locales per record: one record leaves the budget at 0.
    assert.deepEqual(await runBackfill(db, cfg, {provider: mockProvider(), limit: 4}), {translated: 4, failed: 0, remaining: 8});
  });

  it('stops at the provider call budget', async () => {
    const {db} = fakeDb();
    // Each record sends 2 strings per language = 4 strings.
    const r = await runBackfill(db, cfg, {provider: mockProvider(), maxCalls: 5});
    assert.deepEqual(r, {translated: 8, failed: 0, remaining: 4});
  });

  it('stops at the time budget', async () => {
    const {db} = fakeDb();
    assert.deepEqual(await runBackfill(db, cfg, {provider: mockProvider(), budgetMs: -1}), {translated: 0, failed: 0, remaining: 12});
  });

  it('one language only, and nothing without a provider', async () => {
    const {db, rows} = fakeDb();
    assert.deepEqual(await runBackfill(db, cfg, {provider: null}), {translated: 0, failed: 0, remaining: 12});
    assert.deepEqual(await runBackfill(db, cfg, {provider: mockProvider(), locale: 'de'}), {translated: 6, failed: 0, remaining: 0});
    assert.ok(rows.every(r => r.locale === 'de'));
  });
});
