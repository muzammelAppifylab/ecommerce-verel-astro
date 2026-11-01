import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

const PRIVACY_BODY = [
  {type: 'p', text: 'How we handle your data.'},
  {type: 'h2', text: 'What we collect'},
  {type: 'p', text: 'Your name.'},
];

/** WP-07: CMS pages (public + /manage/pages) and menus (/manage/menus), against Postgres. */
describe.skipIf(!DATABASE_URL)('CMS pages and menus (integration, real Postgres)', () => {
  let owner: Browser;
  let staff: Browser;
  let customer: Browser;
  const guest = () => new Browser(app);

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
    staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
    customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
    const id = await userId('staff@example.test');
    expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
    await db.page.createMany({
      data: [
        {slug: 'privacy', title: 'Privacy policy', body: PRIVACY_BODY, published: true},
        {slug: 'terms', title: 'Terms', body: [{type: 'p', text: 'Terms.'}], published: true, seoTitle: 'Our terms'},
        {slug: 'hidden-page', title: 'Hidden', body: [], published: false},
      ],
    });
  });

  it('reads a published page, publicly cacheable', async () => {
    const res = await guest().get('/site-api/pages/privacy');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({slug: 'privacy', title: 'Privacy policy', body: PRIVACY_BODY, seoTitle: null, seoDescription: null});
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('vary')).toContain('X-Locale');
    const terms = await guest().get('/site-api/pages/terms');
    expect(terms.json.seoTitle).toBe('Our terms');
  });

  it('answers 404 for hidden, missing and malformed pages, never cached publicly', async () => {
    for (const slug of ['hidden-page', 'nope', 'Bad_Slug', 'a--b']) {
      const res = await guest().get(`/site-api/pages/${slug}`);
      expect(res.status, slug).toBe(404);
      expect(res.json).toMatchObject({error: 'not_found', message: 'We cannot find that page'});
      expect(res.headers.get('cache-control') ?? '').not.toContain('public');
    }
  });

  it('lists published pages in the sitemap, privacy and terms at their own paths', async () => {
    await db.page.create({data: {slug: 'shipping', title: 'Shipping', body: [], published: true}});
    const res = await guest().get('/site-api/pages/sitemap');
    expect(res.status).toBe(200);
    const items = res.json.items as {path: string; updatedAt: string | null}[];
    expect(items.map(i => i.path)).toEqual(['/privacy/', '/pages/shipping/', '/terms/']);
    expect(items.every(i => typeof i.updatedAt === 'string')).toBe(true);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    await db.page.deleteMany({where: {slug: {in: ['privacy', 'terms']}}});
    const builtIn = (await guest().get('/site-api/pages/sitemap')).json.items as {path: string; updatedAt: string | null}[];
    expect(builtIn).toContainEqual({path: '/privacy/', updatedAt: null});
    expect(builtIn).toContainEqual({path: '/terms/', updatedAt: null});
  });

  it('guards the admin routes', async () => {
    expect((await guest().get('/site-api/manage/pages')).status).toBe(401);
    expect((await customer.get('/site-api/manage/pages')).status).toBe(403);
    expect((await customer.get('/site-api/manage/menus')).status).toBe(403);
    expect((await customer.request('PUT', '/site-api/manage/menus/header', {title: 'Header', items: []})).status).toBe(403);
    expect((await staff.get('/site-api/manage/pages')).status).toBe(200);
  });

  it('lists pages without bodies and reads one by id or slug', async () => {
    const list = await owner.get('/site-api/manage/pages');
    expect(list.status).toBe(200);
    const rows = list.json as unknown as {id: string; slug: string; body?: unknown}[];
    expect(rows.map(r => r.slug)).toEqual(['hidden-page', 'privacy', 'terms']);
    expect(rows.every(r => r.body === undefined && typeof r.id === 'string')).toBe(true);
    const privacy = rows.find(r => r.slug === 'privacy')!;
    expect((await owner.get(`/site-api/manage/pages/${privacy.id}`)).json).toMatchObject({id: privacy.id, slug: 'privacy', body: PRIVACY_BODY});
    expect((await owner.get('/site-api/manage/pages/privacy')).json).toMatchObject({id: privacy.id});
    expect((await owner.get('/site-api/manage/pages/99999')).status).toBe(404);
  });

  it('creates pages hidden by default, with a slug from the title', async () => {
    const res = await owner.post('/site-api/manage/pages', {title: 'Shipping information'});
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({slug: 'shipping-information', published: false, body: [], seoTitle: null});
    expect((await guest().get('/site-api/pages/shipping-information')).status).toBe(404);
    for (const slug of ['new', 'sitemap']) {
      const reserved = await owner.post('/site-api/manage/pages', {title: 'X', slug});
      expect(reserved.status).toBe(422);
      expect(reserved.json.fields).toMatchObject({slug: 'That slug is reserved'});
    }
    const dup = await owner.post('/site-api/manage/pages', {title: 'Again', slug: 'privacy'});
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({error: 'slug_taken', fields: {slug: 'That slug is already in use'}});
    const bad = await owner.post('/site-api/manage/pages', {title: 'X', body: [{type: 'p', text: ''}]});
    expect(bad.status).toBe(422);
    expect(bad.json.fields).toHaveProperty('body.0.text');
  });

  it('updates a page and refuses a slug clash', async () => {
    const id = (await db.page.findUniqueOrThrow({where: {slug: 'privacy'}, select: {id: true}})).id;
    const res = await owner.request('PATCH', `/site-api/manage/pages/${id}`, {
      title: 'Privacy',
      body: [{type: 'p', text: 'New words.'}],
      seoTitle: '',
      seoDescription: 'Short.',
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({title: 'Privacy', body: [{type: 'p', text: 'New words.'}], seoTitle: null, seoDescription: 'Short.'});
    expect((await guest().get('/site-api/pages/privacy')).json.title).toBe('Privacy');
    const clash = await owner.request('PATCH', `/site-api/manage/pages/${id}`, {slug: 'terms'});
    expect(clash.status).toBe(409);
    expect((await owner.request('PATCH', '/site-api/manage/pages/99999', {title: 'X'})).status).toBe(404);
    expect((await staff.request('PATCH', `/site-api/manage/pages/${id}`, {published: false})).status).toBe(200);
    expect((await guest().get('/site-api/pages/privacy')).status).toBe(404);
  });

  it('deletes a page', async () => {
    const id = (await db.page.findUniqueOrThrow({where: {slug: 'terms'}, select: {id: true}})).id;
    expect((await owner.delete(`/site-api/manage/pages/${id}`)).status).toBe(204);
    expect((await guest().get('/site-api/pages/terms')).status).toBe(404);
    expect((await owner.delete(`/site-api/manage/pages/${id}`)).status).toBe(404);
  });

  it('always lists the four menus and upserts one', async () => {
    const empty = await owner.get('/site-api/manage/menus');
    expect(empty.status).toBe(200);
    const menus = empty.json as unknown as {key: string; stored: boolean; id: string | null; items: unknown[]}[];
    expect(menus.map(m => m.key)).toEqual(['header', 'footer-studio', 'footer-shop', 'footer-help']);
    expect(menus.every(m => !m.stored && m.id === null && m.items.length === 0)).toBe(true);

    const saved = await owner.request('PUT', '/site-api/manage/menus/footer-shop', {title: 'Shop', items: [{label: 'Women', url: '/shop/women/'}]});
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({key: 'footer-shop', title: 'Shop', stored: true, items: [{label: 'Women', url: '/shop/women/'}]});
    const again = await staff.request('PUT', '/site-api/manage/menus/footer-shop', {title: 'Store', items: []});
    expect(again.json).toMatchObject({id: saved.json.id, title: 'Store', items: []});

    expect((await owner.request('PUT', '/site-api/manage/menus/sidebar', {title: 'X', items: []})).status).toBe(404);
    const bad = await owner.request('PUT', '/site-api/manage/menus/header', {title: 'Header', items: [{label: 'X', url: '//evil.test'}]});
    expect(bad.status).toBe(422);
    expect(bad.json.fields).toMatchObject({'items.0.url': 'Start with / for a store page, or use a full https:// link'});
  });
});
