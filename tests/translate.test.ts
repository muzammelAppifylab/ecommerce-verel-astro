/* Content translation engine (WP-25; port of VAREL tests/i18n.test.ts `sourceHash` + `translateEntity`, plus the
   per-save queue). The read side (locale picking, structured leaves, chunking) is F4's tests/i18n.test.ts. */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it, vi} from 'vitest';

import {mockProvider} from '../src/server/lib/i18n/providers/mock';
import type {TranslationProvider} from '../src/server/lib/i18n/providers/types';
import {normalizeSource} from '../src/server/lib/i18n/sources';
import {sourceHash, translateEntity} from '../src/server/lib/i18n/translate';

import {cfg, fakeDb} from './translation-helpers';

describe('sourceHash', () => {
  it('is the first 16 hex chars of SHA-256 (string or JSON.stringify)', async () => {
    assert.equal(await sourceHash('abc'), 'ba7816bf8f01cfea');
    assert.equal(await sourceHash([{type: 'p', text: 'abc'}]), await sourceHash(JSON.stringify([{type: 'p', text: 'abc'}])));
    assert.notEqual(await sourceHash('abc'), await sourceHash('abd'));
  });
});

describe('translateEntity (mock provider)', () => {
  it('translates into every enabled locale, then skips up-to-date rows', async () => {
    const {db, rows} = fakeDb();
    const r = await translateEntity(db, 'product', 'coat', {name: 'Atelier wool coat', care: null}, {config: cfg, provider: mockProvider()});
    assert.equal(r.translated, 5);
    assert.deepEqual(rows.map(x => x.locale).sort(), ['da', 'de', 'es', 'fr', 'sv']);
    assert.equal(rows.find(x => x.locale === 'de')!.value, '[de] Atelier wool coat');
    const again = await translateEntity(db, 'product', 'coat', {name: 'Atelier wool coat'}, {config: cfg, provider: mockProvider()});
    assert.equal(again.translated, 0);
    assert.equal(again.skipped, 5);
  });

  it('redoes stale auto rows and keeps manual ones (stale by hash)', async () => {
    const {db, rows} = fakeDb();
    await translateEntity(db, 'product', 'coat', {name: 'Coat'}, {config: cfg, provider: mockProvider()});
    Object.assign(rows.find(x => x.locale === 'da')!, {value: 'Frakke', source: 'manual'});
    await translateEntity(db, 'product', 'coat', {name: 'Wool coat'}, {config: cfg, provider: mockProvider()});
    assert.equal(rows.find(x => x.locale === 'de')!.value, '[de] Wool coat');
    const manual = rows.find(x => x.locale === 'da')!;
    assert.equal(manual.value, 'Frakke');
    assert.notEqual(manual.sourceHash, await sourceHash('Wool coat')); // flagged stale
    await translateEntity(db, 'product', 'coat', {name: 'Wool coat'}, {config: cfg, provider: mockProvider(), overwriteManual: true, force: true});
    const redone = rows.find(x => x.locale === 'da')!;
    assert.equal(redone.value, '[da] Wool coat');
    assert.equal(redone.source, 'auto');
  });

  it('stores structured values as JSON and drops auto rows when the source is emptied', async () => {
    const {db, rows} = fakeDb();
    await translateEntity(db, 'menu', 'm1', {items: [{label: 'Journal', url: '/journal'}]}, {config: cfg, provider: mockProvider(), locales: ['sv']});
    assert.deepEqual(JSON.parse(rows[0]!.value), [{label: '[sv] Journal', url: '/journal'}]);
    assert.equal(normalizeSource([]), null);
    await translateEntity(db, 'menu', 'm1', {items: []}, {config: cfg, provider: mockProvider()});
    assert.equal(rows.length, 0);
  });

  it('keeps manual rows when the source is emptied', async () => {
    const {db, rows} = fakeDb();
    await translateEntity(db, 'product', 'p', {care: 'Dry clean'}, {config: cfg, provider: mockProvider(), locales: ['da', 'de']});
    rows.find(x => x.locale === 'da')!.source = 'manual';
    await translateEntity(db, 'product', 'p', {care: '  '}, {config: cfg, provider: mockProvider()});
    assert.deepEqual(
      rows.map(r => `${r.locale}:${r.source}`),
      ['da:manual']
    );
  });

  it('skips everything without a provider', async () => {
    const {db, rows} = fakeDb();
    const r = await translateEntity(db, 'product', 'p', {name: 'Coat'}, {config: cfg, provider: null});
    assert.deepEqual(r, {translated: 0, failed: 0, skipped: 5});
    assert.equal(rows.length, 0);
  });

  it('counts a failing provider as failed and writes nothing', async () => {
    const {db, rows} = fakeDb();
    const broken: TranslationProvider = {
      name: 'mock',
      batchSize: 10,
      translate: async () => {
        throw new Error('down');
      },
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await translateEntity(db, 'product', 'p', {name: 'Coat', short: 'Warm'}, {config: cfg, provider: broken, locales: ['da']});
    err.mockRestore();
    assert.deepEqual(r, {translated: 0, failed: 2, skipped: 0});
    assert.equal(rows.length, 0);
  });

  it('counts the strings sent to the provider (the backfill budget)', async () => {
    const {db} = fakeDb();
    let calls = 0;
    await translateEntity(db, 'product', 'p', {name: 'Coat', short: 'Warm'}, {config: cfg, provider: mockProvider(), onCall: n => (calls += n)});
    assert.equal(calls, 10);
  });
});

// ─── The per-save queue (the `queueEntityTranslation` contract) ────────────

const sent: {url: string; list: string; data: unknown; key?: string}[] = [];
let reject: Error | null = null;

vi.mock('../src/platform/background', async importOriginal => {
  const real = await importOriginal<typeof import('../src/platform/background')>();
  return {
    ...real,
    sendJob: vi.fn(async (url: string, list: string, data: unknown, options: {key?: string} = {}) => {
      if (reject) throw reject;
      sent.push({url, list, data, key: options.key});
      return {id: 'j1', local: true};
    }),
  };
});

describe('enqueueTranslation', () => {
  const setting = (over: Partial<{translationProvider: string; autoTranslate: boolean}> = {}) => ({
    findUnique: async () => ({defaultLocale: 'en', locales: ['en', 'da'], translationProvider: 'mock', autoTranslate: true, ...over}),
  });
  const discountDb = (name: string, over = {}) =>
    fakeDb({
      setting: setting(over),
      discount: {findMany: async () => [{id: 7, code: 'WELCOME', name, label: null, description: null}]},
    }).db;

  beforeEach(() => {
    sent.length = 0;
    reject = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends one job keyed by the content hash', async () => {
    const {enqueueTranslation} = await import('../src/server/lib/i18n/translate');
    await enqueueTranslation(discountDb('Welcome'), 'discount', 7, {requestUrl: 'https://shop.test/site-api/manage/discounts'});
    await enqueueTranslation(discountDb('Welcome'), 'discount', 7, {requestUrl: 'https://shop.test/x'});
    await enqueueTranslation(discountDb('Welcome back'), 'discount', 7, {requestUrl: 'https://shop.test/x'});
    assert.equal(sent.length, 3);
    assert.equal(sent[0]!.list, 'translations-backfill');
    assert.deepEqual(sent[0]!.data, {entity: 'discount', id: '7'});
    assert.match(sent[0]!.key!, /^tr-discount-7-[0-9a-f]{8}$/);
    assert.equal(sent[0]!.key, sent[1]!.key);
    assert.notEqual(sent[0]!.key, sent[2]!.key);
  });

  it('sends nothing when auto-translation is off, the provider is not ready, or the input is wrong', async () => {
    const {enqueueTranslation} = await import('../src/server/lib/i18n/translate');
    await enqueueTranslation(discountDb('W', {autoTranslate: false}), 'discount', 7, {requestUrl: 'https://shop.test/'});
    await enqueueTranslation(discountDb('W', {translationProvider: 'none'}), 'discount', 7, {requestUrl: 'https://shop.test/'});
    await enqueueTranslation(discountDb('W'), 'nope', 7, {requestUrl: 'https://shop.test/'});
    await enqueueTranslation(discountDb('W'), 'ui', 'layout', {requestUrl: 'https://shop.test/'});
    await enqueueTranslation(discountDb('W'), 'discount', null, {requestUrl: 'https://shop.test/'});
    assert.equal(sent.length, 0);
  });

  it('swallows a refused send', async () => {
    const {enqueueTranslation} = await import('../src/server/lib/i18n/translate');
    const {JobRejected} = await import('../src/platform/background');
    reject = new JobRejected('slow down', 'E_JOBS_RATE_LIMITED', 429);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await enqueueTranslation(discountDb('W'), 'discount', 7, {requestUrl: 'https://shop.test/'});
    assert.equal(warn.mock.calls.length, 1);
    assert.equal(sent.length, 0);
  });
});
