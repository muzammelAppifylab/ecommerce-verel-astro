import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import '../../src/server/background';
import {getDb} from '../../src/platform/db';
import {inRequestScope} from '../../src/platform/request-scope';
import {app} from '../../src/server/app';
import {sendEmailJob} from '../../src/server/jobs/send-email';
import {sendTemplate} from '../../src/server/lib/contracts';
import {deliverMessage, sweepQueued} from '../../src/server/lib/email/send';
import {notifyLowStock, sendOrderEmail, sendReturnUpdate} from '../../src/server/lib/email/triggers';
import {env} from './support/cloudflare-workers';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** Settings · Emails (WP-22): admin routes, sendTemplate, the send-email job and its sweep, against Postgres. */

const BASE = '/site-api/manage/emails';
const job = (attempt = 1, maxAttempts = 5) => ({id: 'job_t', list: 'send-email', attempt, maxAttempts, scheduledFor: '', group: null, local: true});

/** Run code the way a request or a job would: in its own scope, its client closed after. */
const scoped = <T>(fn: () => Promise<T>) =>
  inRequestScope(async () => {
    try {
      return await fn();
    } finally {
      await getDb()?.$disconnect();
    }
  });

/** Answer the Resend API from the test; everything else goes to the harness's fetch. */
let resendCalls: {body: Record<string, unknown>; headers: Headers}[] = [];
let resendAnswer: () => Response = () => new Response(JSON.stringify({id: 're_ok'}), {status: 200});
const harnessFetch = globalThis.fetch;
function useResend() {
  resendCalls = [];
  resendAnswer = () => new Response(JSON.stringify({id: 're_ok'}), {status: 200});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.resend.com/emails') {
      resendCalls.push({body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers)});
      return resendAnswer();
    }
    return harnessFetch(input, init);
  }) as typeof fetch;
}

async function setProvider(provider: string) {
  await db.setting.update({where: {id: 1}, data: {emailProvider: provider}});
}

describe.skipIf(!DATABASE_URL)('emails (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  afterEach(() => {
    globalThis.fetch = harnessFetch;
    delete env.EMAIL_API_KEY;
  });
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    await db.setting.update({where: {id: 1}, data: {storeName: 'VAREL', supportEmail: 'care@varel.studio', defaultLocale: 'en', locales: ['en', 'da']}});
  }, 120_000);

  it('guards: guests 401, customers and staff without settings 403, the owner 200', async () => {
    expect((await new Browser(app).get(`${BASE}/templates`)).status).toBe(401);
    expect((await customer.get(`${BASE}/templates`)).status).toBe(403);
    expect((await staff.get(`${BASE}/templates`)).status).toBe(403);
    expect((await staff.get(`${BASE}/messages`)).status).toBe(403);
    expect((await staff.post(`${BASE}/templates/welcome/test`, {})).status).toBe(403);
    const res = await owner.get(`${BASE}/templates`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('lists the 9 active templates with stats from the counters; retired ones are 404', async () => {
    await db.emailTemplate.create({data: {key: 'welcome', subject: 'Hi {{firstName}}', body: 'b', sentCount: 3, failedCount: 1, lastSentAt: new Date('2026-10-01T00:00:00Z')}});
    const list = (await owner.get(`${BASE}/templates`)).json as unknown as {key: string; stats: unknown; customised: boolean}[];
    expect(list).toHaveLength(9);
    expect(list.map(t => t.key)).not.toContain('password_reset');
    const welcome = list.find(t => t.key === 'welcome')!;
    expect(welcome.stats).toEqual({sent: 3, failed: 1, lastAt: '2026-10-01T00:00:00.000Z'});
    expect(welcome.customised).toBe(true);
    expect((await owner.get(`${BASE}/templates/password_reset`)).status).toBe(404);
    expect((await owner.get(`${BASE}/templates/nope`)).status).toBe(404);
  });

  it('PATCH validates, toggling creates the row with default text, reset keeps enabled', async () => {
    const long = await owner.request('PATCH', `${BASE}/templates/welcome`, {subject: 'x'.repeat(201)});
    expect(long.status).toBe(422);
    expect((long.json.fields as Record<string, string>).subject).toBe('Keep the subject under 200 characters');
    const open = await owner.request('PATCH', `${BASE}/templates/welcome`, {body: '{{#items}}x'});
    expect((open.json.fields as Record<string, string>).body).toBe('{{#items}} is not closed with {{/items}}');

    const off = await owner.request('PATCH', `${BASE}/templates/welcome`, {enabled: false});
    expect(off.status).toBe(200);
    expect(off.json).toMatchObject({enabled: false, customised: false});
    expect(await db.emailTemplate.findUnique({where: {key: 'welcome'}, select: {enabled: true}})).toEqual({enabled: false});

    await owner.request('PATCH', `${BASE}/templates/welcome`, {subject: 'Changed'});
    const reset = await owner.post(`${BASE}/templates/welcome/reset`);
    expect(reset.status).toBe(200);
    expect(reset.json).toMatchObject({enabled: false, customised: false});
  });

  it('preview renders a draft without saving and reports unknown variables and problems', async () => {
    const res = await owner.post(`${BASE}/templates/welcome/preview`, {subject: 'Hi {{firstName}}', body: 'Hello {{mystery}}\n{{#a}}', vars: {firstName: 'Mira'}});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({subject: 'Hi Mira', unknown: ['mystery', 'a'], problem: '{{#a}} is not closed with {{/a}}'});
    expect(await db.emailTemplate.count()).toBe(0);
  });

  it('a test send on the outbox is stored with [Test], even when the template is off', async () => {
    await owner.request('PATCH', `${BASE}/templates/welcome`, {enabled: false});
    const res = await owner.post(`${BASE}/templates/welcome/test`, {});
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({status: 'stored', to: 'owner@example.test', template: 'welcome', relatedType: 'test'});
    expect(String(res.json.subject)).toMatch(/^\[Test\] /);
    expect(String(res.json.html)).toContain('<html');
    const bad = await owner.post(`${BASE}/templates/welcome/test`, {to: 'not-an-address'});
    expect(bad.status).toBe(422);
  });

  it('sendTemplate: stored on the outbox, skipped when off, failed without a valid address, retired keys record nothing', async () => {
    await sendTemplate(db, 'welcome', ' Mira@Studio.DK ', {firstName: 'Mira'});
    await db.emailTemplate.create({data: {key: 'account_deleted', subject: 's', body: 'b', enabled: false}});
    await sendTemplate(db, 'account_deleted', 'mira@studio.dk', {});
    await sendTemplate(db, 'welcome', 'nobody', {});
    await sendTemplate(db, 'password_reset', 'mira@studio.dk', {});
    await sendTemplate(db, 'unknown_key', 'mira@studio.dk', {});
    const rows = await db.emailMessage.findMany({orderBy: {id: 'asc'}, select: {template: true, to: true, status: true, error: true}});
    expect(rows).toEqual([
      {template: 'welcome', to: 'mira@studio.dk', status: 'stored', error: null},
      {template: 'account_deleted', to: 'mira@studio.dk', status: 'skipped', error: 'Template is turned off'},
      {template: 'welcome', to: 'nobody', status: 'failed', error: 'No valid recipient address'},
    ]);
  });

  it('picks the recipient language from the order, with a per-field fallback; staff templates stay in the default', async () => {
    const order = await db.shopOrder.create({
      data: {number: 'VRL-9001', email: 'mira@studio.dk', method: 'Standard', locale: 'da', subtotalCents: 1000, totalCents: 1000, currency: 'USD', placedAt: new Date()},
      select: {id: true},
    });
    await db.translation.create({data: {entity: 'email_template', entityId: 'order_shipped', field: 'subject', locale: 'da', value: 'Afsendt {{orderNumber}}', source: 'manual', sourceHash: 'x'}});
    await sendOrderEmail(db, order.id, 'order_shipped');
    const row = await db.emailMessage.findFirstOrThrow({where: {template: 'order_shipped'}, select: {subject: true, html: true, relatedType: true, relatedId: true}});
    expect(row.subject).toBe('Afsendt VRL-9001');
    expect(row.html).toContain('<html lang="da"');
    expect(row).toMatchObject({relatedType: 'order', relatedId: String(order.id)});

    await db.translation.create({data: {entity: 'email_template', entityId: 'low_stock_alert', field: 'subject', locale: 'da', value: 'Lav', source: 'manual', sourceHash: 'x'}});
    await sendTemplate(db, 'low_stock_alert', 'care@varel.studio', {orderNumber: 'VRL-9001', threshold: 6, items: []}, {locale: 'da'});
    const alert = await db.emailMessage.findFirstOrThrow({where: {template: 'low_stock_alert'}, select: {subject: true}});
    expect(alert.subject).not.toBe('Lav');
  });

  it('returns and low stock build their emails from the database', async () => {
    const order = await db.shopOrder.create({
      data: {
        number: 'VRL-9002',
        email: 'ida@studio.dk',
        method: 'Standard',
        subtotalCents: 5000,
        totalCents: 5000,
        currency: 'USD',
        placedAt: new Date(),
        items: {create: [{name: 'Knit', category: 'Knitwear', sku: 'k', qty: 1, priceCents: 5000, position: 0, image: {}, options: {}}]},
      },
      select: {id: true, items: {select: {id: true}}},
    });
    const ret = await db.returnRequest.create({
      data: {orderId: order.id, email: 'ida@studio.dk', status: 'Rejected', items: [{lineId: String(order.items[0]!.id), qty: 1}], note: 'Worn'},
      select: {id: true},
    });
    await sendReturnUpdate(db, ret.id);
    const r = await db.emailMessage.findFirstOrThrow({where: {template: 'return_update'}, select: {to: true, text: true, relatedType: true}});
    expect(r).toMatchObject({to: 'ida@studio.dk', relatedType: 'return'});
    expect(r.text).toContain('Knit');
    // No variants with tracked stock crossed: nothing sent.
    await notifyLowStock(db, {id: order.id, number: 'VRL-9002'}, [{variantId: 'none', qty: 1}]);
    expect(await db.emailMessage.count({where: {template: 'low_stock_alert'}})).toBe(0);
  });

  it('a provider: the request path queues a job that delivers once; a second run does nothing', async () => {
    await setProvider('resend');
    env.EMAIL_API_KEY = 're_test_key';
    useResend();
    await db.emailTemplate.create({data: {key: 'welcome', subject: 'Welcome', body: 'Hello'}});
    await scoped(() => sendTemplate(getDb()!, 'welcome', 'mira@studio.dk', {}, {requestUrl: 'https://shop.example.test/site-api/x', replyTo: 'help@varel.studio'}));
    const row = await db.emailMessage.findFirstOrThrow({select: {id: true, status: true, providerId: true, attempts: true, provider: true}});
    expect(row).toMatchObject({status: 'sent', providerId: 're_ok', attempts: 1, provider: 'resend'});
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0]!.headers.get('idempotency-key')).toBe(`email-${row.id}`);
    expect(resendCalls[0]!.body.reply_to).toBe('help@varel.studio');
    expect(await db.emailTemplate.findUnique({where: {key: 'welcome'}, select: {sentCount: true}})).toEqual({sentCount: 1});

    await scoped(() => sendEmailJob({messageId: String(row.id)}, job()));
    expect(resendCalls).toHaveLength(1);
  });

  it('a held claim stops a parallel delivery', async () => {
    await setProvider('resend');
    env.EMAIL_API_KEY = 'k';
    useResend();
    const m = await db.emailMessage.create({data: {to: 'a@b.co', subject: 's', html: 'h', text: 't', provider: 'resend', status: 'queued', claimedAt: new Date()}});
    expect(await deliverMessage(db, m.id)).toMatchObject({noop: 'claimed'});
    expect(resendCalls).toHaveLength(0);
  });

  it('retryable failures stay queued and throw; on the last try or a missing key they fail', async () => {
    await setProvider('resend');
    env.EMAIL_API_KEY = 'k';
    useResend();
    resendAnswer = () => new Response(JSON.stringify({message: 'busy'}), {status: 503});
    const m = await db.emailMessage.create({data: {template: 'welcome', to: 'a@b.co', subject: 's', html: 'h', text: 't', provider: 'resend', status: 'queued'}});
    await expect(scoped(() => sendEmailJob({messageId: String(m.id)}, job(1)))).rejects.toThrow(/busy/);
    expect(await db.emailMessage.findUnique({where: {id: m.id}, select: {status: true, error: true, claimedAt: true}})).toEqual({
      status: 'queued',
      error: '503 busy',
      claimedAt: null,
    });
    await scoped(() => sendEmailJob({messageId: String(m.id)}, job(5)));
    expect(await db.emailMessage.findUnique({where: {id: m.id}, select: {status: true, attempts: true}})).toEqual({status: 'failed', attempts: 2});

    delete env.EMAIL_API_KEY;
    const k = await db.emailMessage.create({data: {to: 'a@b.co', subject: 's', html: 'h', text: 't', provider: 'resend', status: 'queued'}});
    await expect(scoped(() => sendEmailJob({messageId: String(k.id)}, job(1)))).rejects.toThrow(/EMAIL_API_KEY is not added/);
    expect(await db.emailMessage.findUnique({where: {id: k.id}, select: {status: true}})).toEqual({status: 'failed'});
  });

  it('the sweep delivers old queued rows and expires week-old ones', async () => {
    await setProvider('resend');
    env.EMAIL_API_KEY = 'k';
    useResend();
    const old = new Date(Date.now() - 10 * 60_000);
    const ancient = new Date(Date.now() - 8 * 24 * 3600_000);
    await db.emailMessage.createMany({
      data: [
        {to: 'a@b.co', subject: '1', html: 'h', text: 't', provider: 'resend', status: 'queued', createdAt: old},
        {to: 'a@b.co', subject: '2', html: 'h', text: 't', provider: 'resend', status: 'queued', createdAt: ancient},
        {to: 'a@b.co', subject: '3', html: 'h', text: 't', provider: 'resend', status: 'queued'},
      ],
    });
    expect(await sweepQueued(db)).toEqual({expired: 1, delivered: 1, failed: 0});
    const rows = await db.emailMessage.findMany({orderBy: {subject: 'asc'}, select: {subject: true, status: true, error: true}});
    expect(rows).toEqual([
      {subject: '1', status: 'sent', error: null},
      {subject: '2', status: 'failed', error: 'Not sent within 7 days'},
      {subject: '3', status: 'queued', error: null},
    ]);
  });

  it('the log pages by keyset and filters; counts cap at 100', async () => {
    const t0 = Date.now();
    await db.emailMessage.createMany({
      data: [
        {template: 'welcome', to: 'mira@studio.dk', subject: 'Welcome Mira', html: 'h', text: 't', provider: 'outbox', status: 'stored', createdAt: new Date(t0 - 3000)},
        {template: 'order_shipped', to: 'ida@studio.dk', subject: 'Shipped', html: 'h', text: 't', provider: 'outbox', status: 'stored', createdAt: new Date(t0 - 2000), relatedType: 'order', relatedId: '5'},
        {template: 'welcome', to: 'ida@studio.dk', subject: 'Welcome Ida', html: 'h', text: 't', provider: 'resend', status: 'failed', createdAt: new Date(t0 - 1000)},
      ],
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const page = (await owner.get(`${BASE}/messages?pageSize=1${cursor ? `&cursor=${cursor}` : ''}`)).json as {items: {subject: string}[]; nextCursor: string | null};
      seen.push(...page.items.map(m => m.subject));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['Welcome Ida', 'Shipped', 'Welcome Mira']);
    expect(cursor).toBeNull();
    const sub = (q: string) => owner.get(`${BASE}/messages?${q}`).then(r => (r.json.items as {subject: string}[]).map(m => m.subject));
    expect(await sub('status=failed')).toEqual(['Welcome Ida']);
    expect(await sub('template=welcome')).toEqual(['Welcome Ida', 'Welcome Mira']);
    expect(await sub('q=IDA@studio.dk')).toEqual(['Welcome Ida', 'Shipped']);
    expect(await sub('q=mira')).toEqual(['Welcome Mira']);
    expect(await sub('relatedType=order&relatedId=5')).toEqual(['Shipped']);
    expect((await owner.get(`${BASE}/messages?status=nope`)).status).toBe(422);

    await db.emailMessage.createMany({data: Array.from({length: 101}, (_, i) => ({to: 'x@y.co', subject: `s${i}`, html: 'h', text: 't', provider: 'outbox', status: 'skipped'}))});
    expect((await owner.get(`${BASE}/messages/counts`)).json).toEqual({stored: 2, queued: 0, sent: 0, failed: 1, skipped: 100, capped: ['skipped']});
  });

  it('detail and resend: a new row through the current provider; bad id 422, missing 404', async () => {
    const m = await db.emailMessage.create({data: {template: 'welcome', to: 'mira@studio.dk', subject: 'S', html: '<p>h</p>', text: 't', provider: 'resend', status: 'failed', error: 'x'}});
    const detail = await owner.get(`${BASE}/messages/${m.id}`);
    expect(detail.json).toMatchObject({id: String(m.id), html: '<p>h</p>', attempts: 0});
    const again = await owner.post(`${BASE}/messages/${m.id}/resend`);
    expect(again.status).toBe(201);
    expect(again.json).toMatchObject({status: 'stored', provider: 'outbox', subject: 'S'});
    expect(again.json.id).not.toBe(String(m.id));
    expect((await owner.get(`${BASE}/messages/abc`)).status).toBe(422);
    expect((await owner.get(`${BASE}/messages/999999`)).status).toBe(404);
    expect((await owner.post(`${BASE}/messages/999999/resend`)).status).toBe(404);
  });

  it('delivery: reads and saves the six columns with the server rules; the key is a boolean only', async () => {
    const got = await owner.get(`${BASE}/delivery`);
    expect(got.json).toMatchObject({emailProvider: 'outbox', secrets: {emailApiKey: false}, supportEmail: 'care@varel.studio'});
    env.EMAIL_API_KEY = 'secret-value';
    expect((await owner.get(`${BASE}/delivery`)).json.secrets).toEqual({emailApiKey: true});
    expect(JSON.stringify((await owner.get(`${BASE}/delivery`)).json)).not.toContain('secret-value');

    const missing = await owner.request('PATCH', `${BASE}/delivery`, {emailProvider: 'webhook'});
    expect(missing.status).toBe(422);
    expect(missing.json.fields).toEqual({'emailConfig.endpoint': 'Use a full link starting with https://'});
    const ip = await owner.request('PATCH', `${BASE}/delivery`, {emailProvider: 'webhook', emailConfig: {endpoint: 'https://10.0.0.1/hook'}});
    expect(ip.status).toBe(422);

    const ok = await owner.request('PATCH', `${BASE}/delivery`, {
      emailProvider: 'webhook',
      emailConfig: {endpoint: 'https://hooks.example.com/varel'},
      emailFromName: ' VAREL ',
      emailFromAddress: 'Care@Varel.Studio',
      emailReplyTo: '',
      staffAlertEmail: 'Ops@Varel.Studio',
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      emailProvider: 'webhook',
      emailConfig: {endpoint: 'https://hooks.example.com/varel'},
      emailFromName: 'VAREL',
      emailFromAddress: 'care@varel.studio',
      emailReplyTo: null,
      staffAlertEmail: 'ops@varel.studio',
    });
    expect((await staff.request('PATCH', `${BASE}/delivery`, {emailFromName: 'x'})).status).toBe(403);
  });
});
