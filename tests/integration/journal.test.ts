import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** Journal (WP-06): public `/site-api/posts*` and admin `/site-api/manage/posts*`, against Postgres. */

const DAY = 86_400_000;
const image = {src: 'https://images.unsplash.com/photo-1', credit: 'Photo by A on Unsplash', creditHref: 'https://unsplash.com/'};
const body = [
  {type: 'p', text: 'Opening words.'},
  {type: 'h2', text: 'Weave'},
  {type: 'quote', text: '“Linen breathes.”', cite: 'Mira'},
  {type: 'list', items: ['One', 'Two']},
];

async function seedPosts() {
  const now = Date.now();
  const rows = [
    {slug: 'linen-in-winter', title: 'Linen in winter', category: 'Materials', publishedAt: new Date(now - 1 * DAY)},
    {slug: 'wool-weights', title: 'Wool weights', category: 'Materials', publishedAt: new Date(now - 2 * DAY)},
    {slug: 'packing-light', title: 'Packing light', category: 'Travel', publishedAt: new Date(now - 3 * DAY)},
    {slug: 'washing-silk', title: 'Washing silk', category: 'Care', publishedAt: new Date(now - 4 * DAY)},
    {slug: 'layering', title: 'Layering', category: 'Styling', publishedAt: new Date(now - 5 * DAY)},
  ];
  for (const r of rows) {
    await db.post.create({
      data: {...r, status: 'published', read: '3 min read', author: 'Mira Halvorsen', excerpt: `${r.title} excerpt`, image, body, seoTitle: r.slug === 'linen-in-winter' ? 'Linen SEO' : null},
    });
  }
  await db.post.create({
    data: {slug: 'a-draft', title: 'A draft', category: 'Materials', status: 'draft', publishedAt: null, read: '1 min read', author: 'A', excerpt: 'x', image, body},
  });
  await db.post.create({
    data: {
      slug: 'scheduled',
      title: 'Scheduled',
      category: 'Materials',
      status: 'published',
      publishedAt: new Date(now + 5 * DAY),
      read: '1 min read',
      author: 'A',
      excerpt: 'x',
      image,
      body,
    },
  });
  const linen = await db.post.findUniqueOrThrow({where: {slug: 'linen-in-winter'}, select: {id: true}});
  const tr = (entity: string, entityId: string, field: string, value: string) =>
    db.translation.create({data: {entity, entityId, field, locale: 'da', value, sourceHash: 'x'}});
  await tr('post', String(linen.id), 'title', 'Hør om vinteren');
  await tr('post', String(linen.id), 'seoTitle', 'Hør SEO');
  await tr('post', String(linen.id), 'body', JSON.stringify([{type: 'p', text: 'Indledning.'}]));
  await tr('post_category', 'Materials', 'name', 'Materialer');
}

const da = {'x-locale': 'da'};

describe.skipIf(!DATABASE_URL)('journal (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());

  describe('public', () => {
    let guest: Browser;
    beforeEach(async () => {
      await resetDatabase();
      await seedPosts();
      guest = new Browser(app);
    });

    it('lists published posts newest first, cached publicly, without ids', async () => {
      const res = await guest.get('/site-api/posts');
      expect(res.status).toBe(200);
      const items = res.json as unknown as {slug: string; id?: unknown}[];
      expect(items.map(p => p.slug)).toEqual(['linen-in-winter', 'wool-weights', 'packing-light', 'washing-silk', 'layering']);
      expect(items[0]!.id).toBeUndefined();
      expect(res.headers.get('cache-control')).toMatch(/public/);
      expect((await guest.get('/site-api/posts?category=')).json).toHaveLength(5);
    });

    it('limits, and refuses a bad limit', async () => {
      expect((await guest.get('/site-api/posts?limit=3')).json).toHaveLength(3);
      for (const bad of ['0', '101', 'abc']) {
        const res = await guest.get(`/site-api/posts?limit=${bad}`);
        expect(res.status).toBe(422);
        expect((res.json.fields as Record<string, string>).limit).toBeTruthy();
      }
    });

    it('filters by category slug, by translated name, and answers [] for an unknown one', async () => {
      const m = (await guest.get('/site-api/posts?category=materials')).json as unknown as {slug: string}[];
      expect(m.map(p => p.slug)).toEqual(['linen-in-winter', 'wool-weights']);
      const t = (await guest.request('GET', '/site-api/posts?category=materialer', undefined, da)).json as unknown as {slug: string}[];
      expect(t).toHaveLength(2);
      expect((await guest.get('/site-api/posts?category=nope')).json).toEqual([]);
    });

    it('lists categories by latest post with counts and translated labels', async () => {
      const res = await guest.request('GET', '/site-api/posts/categories', undefined, da);
      const cats = res.json as unknown as {name: string; count: number; label: string}[];
      expect(cats.map(c => c.name)).toEqual(['Materials', 'Travel', 'Care', 'Styling']);
      expect(cats[0]).toMatchObject({count: 2, label: 'Materialer'});
    });

    it('serves a post with related posts, same category first', async () => {
      const res = await guest.get('/site-api/posts/linen-in-winter');
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({slug: 'linen-in-winter', seoTitle: 'Linen SEO', seoDescription: null});
      expect(res.json.updatedAt).toBeTruthy();
      const related = (res.json.related as {slug: string}[]).map(p => p.slug);
      expect(related).toEqual(['wool-weights', 'packing-light', 'washing-silk']);
      expect((res.json.body as unknown[]).length).toBe(4);
    });

    it('overlays the Danish title, body and SEO title', async () => {
      const res = await guest.request('GET', '/site-api/posts/linen-in-winter', undefined, da);
      expect(res.json).toMatchObject({title: 'Hør om vinteren', seoTitle: 'Hør SEO', categoryLabel: 'Materialer'});
      expect(res.json.body).toEqual([{type: 'p', text: 'Indledning.'}]);
    });

    it('404s drafts, scheduled, unknown and impossible slugs, never cached', async () => {
      for (const slug of ['a-draft', 'scheduled', 'nope', 'Bad_Slug']) {
        const res = await guest.get(`/site-api/posts/${slug}`);
        expect(res.status).toBe(404);
        expect(res.json.error).toBe('not_found');
        expect(res.headers.get('cache-control') ?? '').not.toMatch(/public/);
      }
    });

    it('feeds the 20 newest in the source language and maps posts and categories', async () => {
      const feed = await guest.request('GET', '/site-api/posts/feed', undefined, da);
      const items = feed.json.items as {slug: string; title: string}[];
      expect(items).toHaveLength(5);
      expect(items[0]).toMatchObject({slug: 'linen-in-winter', title: 'Linen in winter'});
      const map = (await guest.get('/site-api/posts/sitemap')).json.items as {path: string; updatedAt: string | null}[];
      const paths = map.map(i => i.path);
      expect(paths).toContain('/journal/linen-in-winter/');
      expect(paths).toContain('/journal/category/materials/');
      expect(paths).not.toContain('/journal/a-draft/');
      expect(paths).not.toContain('/journal/scheduled/');
      expect(map.find(i => i.path === '/journal/linen-in-winter/')!.updatedAt).toBeTruthy();
    });
  });

  describe('admin', () => {
    let owner: Browser;
    beforeEach(async () => {
      await resetDatabase();
      await seedPosts();
      owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
      const staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
      const id = await userId('staff@example.test');
      expect((await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']})).status).toBe(200);
      owner = staff; // staff hold `content` by default
    });

    it('refuses guests and customers', async () => {
      expect((await new Browser(app).get('/site-api/manage/posts')).status).toBe(401);
      const customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
      expect((await customer.get('/site-api/manage/posts')).status).toBe(403);
    });

    it('lists with filters, sorts and keyset pages', async () => {
      const all = await owner.get('/site-api/manage/posts');
      expect(all.status).toBe(200);
      expect((all.json.items as unknown[]).length).toBe(7);
      const drafts = (await owner.get('/site-api/manage/posts?status=draft')).json.items as {slug: string}[];
      expect(drafts.map(p => p.slug)).toEqual(['a-draft']);
      const both = (await owner.get('/site-api/manage/posts?status=draft,published')).json.items as unknown[];
      expect(both).toHaveLength(7);
      const cat = (await owner.get('/site-api/manage/posts?category=materials')).json.items as unknown[];
      expect(cat).toHaveLength(4);
      const q = (await owner.get('/site-api/manage/posts?q=linen%20winter')).json.items as {slug: string}[];
      expect(q.map(p => p.slug)).toEqual(['linen-in-winter']);
      expect((await owner.get('/site-api/manage/posts?sort=nope')).status).toBe(422);
      for (const sort of ['title', '-title', 'category', 'status', 'updatedAt', '-updatedAt', 'publishedAt', '-publishedAt']) {
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const url: string = `/site-api/manage/posts?sort=${sort}&pageSize=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
          const page = await owner.get(url);
          expect(page.status).toBe(200);
          seen.push(...(page.json.items as {slug: string}[]).map(p => p.slug));
          cursor = page.json.nextCursor as string | null;
        } while (cursor);
        expect(new Set(seen).size).toBe(7);
        expect(seen).toHaveLength(7);
      }
      // publishedAt sorts drafts (no date) last in both directions.
      const desc = (await owner.get('/site-api/manage/posts?sort=-publishedAt')).json.items as {slug: string}[];
      expect(desc.at(-1)!.slug).toBe('a-draft');
      expect(desc[0]!.slug).toBe('scheduled');
      const asc = (await owner.get('/site-api/manage/posts?sort=publishedAt')).json.items as {slug: string}[];
      expect(asc.at(-1)!.slug).toBe('a-draft');
    });

    it('creates, with a default slug, publish date and reading time; refuses a taken slug', async () => {
      const input = {title: 'New Post Here', category: 'Care', author: 'Ana', status: 'published', excerpt: 'Short.', image, body};
      const res = await owner.request('POST', '/site-api/manage/posts', input);
      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({slug: 'new-post-here', status: 'published', read: '1 min read'});
      expect(res.json.publishedAt).toBeTruthy();
      const again = await owner.request('POST', '/site-api/manage/posts', input);
      expect(again.status).toBe(409);
      expect((again.json.fields as Record<string, string>).slug).toBeTruthy();
      const reserved = await owner.request('POST', '/site-api/manage/posts', {...input, slug: 'feed'});
      expect(reserved.status).toBe(422);
      const bad = await owner.request('POST', '/site-api/manage/posts', {...input, title: '', image: {src: 'http://x'}, body: [{type: 'p', text: ''}]});
      expect(bad.status).toBe(422);
      const fields = bad.json.fields as Record<string, string>;
      expect(fields.title).toBeTruthy();
      expect(fields['image.src']).toBeTruthy();
      expect(fields['body.0.text']).toBeTruthy();
    });

    it('patches status, keeps the date on drafts, refuses slug changes, recomputes reading time', async () => {
      const pub = await owner.request('PATCH', '/site-api/manage/posts/a-draft', {status: 'published'});
      expect(pub.status).toBe(200);
      const date = pub.json.publishedAt as string;
      expect(date).toBeTruthy();
      const back = await owner.request('PATCH', '/site-api/manage/posts/a-draft', {status: 'draft'});
      expect(back.json).toMatchObject({status: 'draft', publishedAt: date});
      expect((await owner.request('PATCH', '/site-api/manage/posts/a-draft', {slug: 'other'})).status).toBe(422);
      const long = Array.from({length: 450}, () => 'word').join(' ');
      const read = await owner.request('PATCH', '/site-api/manage/posts/a-draft', {body: [{type: 'p', text: long}]});
      expect(read.json.read).toBe('3 min read');
      expect((await owner.request('PATCH', '/site-api/manage/posts/nope', {status: 'draft'})).status).toBe(404);
    });

    it('reads one and deletes', async () => {
      const one = await owner.get('/site-api/manage/posts/linen-in-winter');
      expect(one.status).toBe(200);
      expect(one.json).toMatchObject({slug: 'linen-in-winter', seoTitle: 'Linen SEO'});
      expect((await owner.delete('/site-api/manage/posts/linen-in-winter')).status).toBe(204);
      expect((await owner.delete('/site-api/manage/posts/linen-in-winter')).status).toBe(404);
      expect((await owner.get('/site-api/manage/posts/linen-in-winter')).status).toBe(404);
    });

    it('refuses writes without the CSRF token', async () => {
      const res = await owner.request('DELETE', '/site-api/manage/posts/layering', undefined, {'x-csrf-token': 'wrong'});
      expect(res.status).toBe(403);
    });
  });
});
