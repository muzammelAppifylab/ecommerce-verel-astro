import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {DontRetry, type JobInfo} from '../../src/platform/background';
import {app} from '../../src/server/app';
import {backfillTranslations} from '../../src/server/jobs/translations-backfill';
import {env} from './support/cloudflare-workers';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** A fake DeepL (the owner secret DEEPL_API_KEY is set for these tests): answers `[da] text`, like the mock
    provider. The database refuses the `mock` provider (settings_translation_provider_check). */
const DEEPL = 'https://api-free.deepl.com/v2/translate';
let deeplCalls = 0;
function fakeDeepl(previous: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== DEEPL) return previous(input, init);
    deeplCalls++;
    const body = JSON.parse(String(init?.body)) as {text: string[]; target_lang: string};
    const to = body.target_lang.toLowerCase();
    return new Response(JSON.stringify({translations: body.text.map(text => ({text: `[${to}] ${text}`}))}), {status: 200});
  }) as typeof fetch;
}

/** Content translations (`/site-api/manage/translations`, WP-25) and the `translations-backfill` job, against
    Postgres, with a fake DeepL (`[da] text`). */
// Sign-ups hash passwords (PBKDF2, 600k): slow on a busy machine.
vi.setConfig({testTimeout: 60_000, hookTimeout: 60_000});

describe.skipIf(!DATABASE_URL)('admin translations (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;
  const base = '/site-api/manage/translations';

  async function seed(provider = 'deepl') {
    await db.setting.update({where: {id: 1}, data: {defaultLocale: 'en', locales: ['en', 'da', 'de'], translationProvider: provider, autoTranslate: true}});
    const dept = await db.department.create({data: {name: 'Women', slug: 'women'}});
    const cat = await db.category.create({data: {name: 'Coats', slug: 'coats', departmentId: dept.id}});
    for (const [id, name] of [
      ['coat', 'Atelier wool coat'],
      ['belt', 'Leather belt'],
      ['scarf', 'Silk scarf'],
    ] as const) {
      await db.product.create({
        data: {id, name, brand: 'VAREL', priceCents: 1000, sku: `SKU-${id}`, short: `${name}, short`, description: '<p>Made slowly.</p>', material: 'Wool', departmentId: dept.id, categoryId: cat.id},
      });
    }
    await db.variant.create({data: {id: 'coat-stone-m', productId: 'coat', color: 'Stone', size: 'M', priceCents: 1000}});
    await db.menu.create({data: {key: 'footer', title: 'Footer', items: [{label: 'Journal', url: '/journal/'}]}});
  }

  let previousFetch: typeof fetch;
  beforeAll(() => {
    configureEnv();
    (env as unknown as Record<string, string>).DEEPL_API_KEY = 'test-key:fx';
    previousFetch = globalThis.fetch;
    globalThis.fetch = fakeDeepl(previousFetch);
  });
  afterAll(async () => {
    delete (env as unknown as Record<string, string>).DEEPL_API_KEY;
    globalThis.fetch = previousFetch;
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    await seed();
  });

  it('guards: guests 401, customers 403, content staff in', async () => {
    expect((await new Browser(app).get(`${base}/status`)).status).toBe(401);
    expect((await customer.get(`${base}/status`)).status).toBe(403);
    expect((await customer.request('POST', `${base}/translate-missing`, {})).status).toBe(403);
    expect((await staff.get(`${base}/status`)).status).toBe(200);
    expect((await staff.get(base)).status).toBe(200);
  });

  it('status: coverage per entity and language', async () => {
    const res = await owner.get(`${base}/status`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({defaultLocale: 'en', locales: ['da', 'de'], provider: 'deepl', providerReady: true, autoTranslate: true});
    const totals = res.json.totals as Record<string, {total: number; missing: number}>;
    expect(totals.da!.total).toBeGreaterThan(0);
    expect(totals.da!.missing).toBe(totals.da!.total);
    const entities = (res.json.entities as {entity: string}[]).map(e => e.entity);
    expect(entities).toContain('product');
    expect(entities).not.toContain('ui'); // da and de have shipped catalogs
  });

  it('list: keyset pages without duplicates, filters and search', async () => {
    const seen = new Set<string>();
    let cursor = '';
    for (let i = 0; i < 3; i++) {
      const res = await owner.get(`${base}?entity=product&locale=da&pageSize=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      const items = res.json.items as {entityId: string; field: string; locale: string; status: string}[];
      expect(items.length).toBe(2);
      for (const it of items) seen.add(`${it.entityId}:${it.field}:${it.locale}`);
      cursor = res.json.nextCursor as string;
      expect(cursor).toBeTruthy();
    }
    expect(seen.size).toBe(6);
    const q = await owner.get(`${base}?locale=da&q=silk`);
    expect((q.json.items as {entityId: string}[]).every(r => r.entityId === 'scarf')).toBe(true);
    const missing = await owner.get(`${base}?locale=da&status=manual`);
    expect(missing.json.items).toEqual([]);
    expect((await owner.get(`${base}?entity=nope`)).status).toBe(422);
  });

  it('translate-missing fills everything over a few calls', async () => {
    let remaining = Infinity;
    for (let i = 0; i < 20 && remaining > 0; i++) {
      const res = await owner.request('POST', `${base}/translate-missing`, {});
      expect(res.status).toBe(200);
      remaining = res.json.remaining as number;
    }
    expect(remaining).toBe(0);
    expect(deeplCalls).toBeGreaterThan(0);
    const status = await owner.get(`${base}/status`);
    expect((status.json.totals as Record<string, {missing: number}>).de!.missing).toBe(0);
    const row = await db.translation.findUnique({where: {entity_entityId_field_locale: {entity: 'product', entityId: 'coat', field: 'name', locale: 'da'}}});
    expect(row).toMatchObject({value: '[da] Atelier wool coat', source: 'auto'});
    expect((await owner.request('POST', `${base}/translate-missing`, {locale: 'nl'})).status).toBe(422);
  });

  it('PUT a manual translation, revert it, retranslate', async () => {
    const put = await owner.request('PUT', `${base}/product/coat`, {field: 'name', locale: 'da', value: 'Uldfrakke'});
    expect(put.status).toBe(200);
    const name = (put.json.fields as {field: string; translations: Record<string, {value: string; source: string; stale: boolean} | null>}[]).find(f => f.field === 'name')!;
    expect(name.translations.da).toMatchObject({value: 'Uldfrakke', source: 'manual', stale: false});

    // Auto-translation keeps the manual edit.
    await owner.request('POST', `${base}/translate-missing`, {entity: 'product', locale: 'da'});
    expect((await db.translation.findFirst({where: {entity: 'product', entityId: 'coat', field: 'name', locale: 'da'}}))!.value).toBe('Uldfrakke');

    const reverted = await owner.request('DELETE', `${base}/product/coat?field=name&locale=da`);
    expect(reverted.status).toBe(200);
    expect((await db.translation.findFirst({where: {entity: 'product', entityId: 'coat', field: 'name', locale: 'da'}}))).toMatchObject({
      value: '[da] Atelier wool coat',
      source: 'auto',
    });

    await owner.request('PUT', `${base}/product/coat`, {field: 'name', locale: 'de', value: 'Mantel'});
    const re = await owner.request('POST', `${base}/retranslate`, {entity: 'product', entityId: 'coat', field: 'name', locale: 'de'});
    expect(re.status).toBe(200);
    expect(re.json.result).toMatchObject({translated: 1});
    expect((await db.translation.findFirst({where: {entity: 'product', entityId: 'coat', field: 'name', locale: 'de'}}))!.value).toBe('[de] Atelier wool coat');
  });

  it('PUT validation', async () => {
    const put = (path: string, body: unknown) => owner.request('PUT', `${base}/${path}`, body);
    expect((await put('product/coat', {field: 'name', locale: 'da', value: '   '})).status).toBe(422);
    expect((await put('product/coat', {field: 'sku', locale: 'da', value: 'x'})).json.fields).toMatchObject({field: 'This field is not translated'});
    expect((await put('product/coat', {field: 'name', locale: 'en', value: 'x'})).status).toBe(422);
    expect((await put('nope/coat', {field: 'name', locale: 'da', value: 'x'})).status).toBe(404);
    expect((await put('product/nope', {field: 'name', locale: 'da', value: 'x'})).status).toBe(404);
    const menu = await db.menu.findFirstOrThrow({where: {key: 'footer'}});
    expect((await put(`menu/${menu.id}`, {field: 'items', locale: 'da', value: '{"label":"x"}'})).json.fields).toMatchObject({
      value: 'Keep the same structure as the source',
    });
    expect((await put(`menu/${menu.id}`, {field: 'items', locale: 'da', value: 'not json'})).status).toBe(422);
    const ok = await put(`menu/${menu.id}`, {field: 'items', locale: 'da', value: [{label: 'Journal på dansk', url: '/journal/'}]});
    expect(ok.status).toBe(200);
  });

  it('without a provider, retranslate and translate-missing answer 409', async () => {
    await db.setting.update({where: {id: 1}, data: {translationProvider: 'none'}});
    expect((await owner.request('POST', `${base}/translate-missing`, {})).status).toBe(409);
    const re = await owner.request('POST', `${base}/retranslate`, {entity: 'product', entityId: 'coat'});
    expect(re.status).toBe(409);
    expect(re.json).toMatchObject({error: 'provider_not_ready'});
  });

  it('the job: one product with its colours; the schedule; bad data', async () => {
    const job = {id: 'j1', list: 'translations-backfill', attempt: 1} as unknown as JobInfo;
    const r = await backfillTranslations({entity: 'product', id: 'coat'}, job);
    expect(r.translated).toBeGreaterThan(0);
    expect(await db.translation.count({where: {entity: 'product', entityId: 'coat'}})).toBeGreaterThan(0);
    expect(await db.translation.count({where: {entity: 'option', entityId: 'Stone'}})).toBe(2);
    expect(await db.translation.count({where: {entity: 'product', entityId: 'belt'}})).toBe(0);

    await db.setting.update({where: {id: 1}, data: {autoTranslate: false}});
    expect(await backfillTranslations(null, job)).toEqual({translated: 0, failed: 0, remaining: 0});
    await db.setting.update({where: {id: 1}, data: {autoTranslate: true}});
    expect((await backfillTranslations({}, job)).translated).toBeGreaterThan(0);

    await expect(backfillTranslations({entity: 'nope', id: '1'}, job)).rejects.toBeInstanceOf(DontRetry);
    await expect(backfillTranslations('x', job)).rejects.toBeInstanceOf(DontRetry);
  });
});
