import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/** Product reviews (WP-04): the public routes and the admin moderation routes, against Postgres. */

const PRODUCT = 'atelier-wool-coat';
const OTHER = 'linen-shirt';
const base = `/site-api/products/${PRODUCT}/reviews`;
const good = {rating: 5, title: 'Beautiful coat', body: 'Warm, well cut and the wool feels lovely.'};

async function seedCatalog() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}, select: {id: true}});
  const cat = await db.category.create({data: {name: 'Coats', slug: 'coats', departmentId: dept.id}, select: {id: true}});
  const product = (id: string, name: string, status = 'published') =>
    db.product.create({
      data: {
        id,
        name,
        status,
        brand: 'VAREL',
        priceCents: 10000,
        sku: id.toUpperCase(),
        short: 'Short',
        description: 'Description',
        material: 'Wool',
        departmentId: dept.id,
        categoryId: cat.id,
      },
      select: {id: true},
    });
  await product(PRODUCT, 'Atelier Wool Coat');
  await product(OTHER, 'Linen Shirt');
  await product('draft-piece', 'Draft', 'draft');
}

let orderSeq = 1;
async function paidOrder(email: string, productId: string, userIdValue: number | null, payment = 'Paid') {
  await db.shopOrder.create({
    data: {
      number: `VRL-${orderSeq++}`,
      email,
      userId: userIdValue,
      payment,
      method: 'Standard',
      subtotalCents: 10000,
      totalCents: 10000,
      items: {create: [{productId, name: 'x', category: 'Coats', sku: 'X', qty: 1, priceCents: 10000, image: {}}]},
    },
  });
}

async function review(productId: string, data: {rating: number; status?: string; createdAt?: Date; email?: string; title?: string}) {
  return db.review.create({
    data: {
      productId,
      name: 'Mira Holm',
      email: data.email ?? 'someone@example.test',
      rating: data.rating,
      title: data.title ?? `Rated ${data.rating}`,
      body: 'A good piece, well made.',
      status: data.status ?? 'approved',
      verifiedPurchase: true,
      ...(data.createdAt ? {createdAt: data.createdAt} : {}),
    },
    select: {id: true},
  });
}

/** Sign-ups hash passwords (PBKDF2, 600k): slow on a busy machine. */
describe.skipIf(!DATABASE_URL)('product reviews (integration, real Postgres)', {timeout: 60_000}, () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
  });

  describe('GET list', () => {
    it('404s unknown and draft products, 422s a big page', async () => {
      const guest = new Browser(app);
      expect((await guest.get('/site-api/products/nope/reviews')).status).toBe(404);
      expect((await guest.get('/site-api/products/draft-piece/reviews')).status).toBe(404);
      expect((await guest.get('/site-api/products/Bad_Slug!/reviews')).status).toBe(404);
      expect((await guest.get(`${base}?pageSize=21`)).status).toBe(422);
    });

    it('returns approved reviews only, public cached, never emails', async () => {
      await review(PRODUCT, {rating: 5});
      await review(PRODUCT, {rating: 4});
      await review(PRODUCT, {rating: 1, status: 'pending'});
      await review(PRODUCT, {rating: 2, status: 'rejected'});
      const res = await new Browser(app).get(base);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=60');
      const body = res.json as {items: Record<string, unknown>[]; total: number; summary: {count: number; avg: number}; nextCursor: string | null; settings: {enabled: boolean}};
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.summary).toMatchObject({count: 2, avg: 4.5});
      expect(body.nextCursor).toBeNull();
      expect(body.settings.enabled).toBe(true);
      for (const item of body.items) {
        expect(item).not.toHaveProperty('email');
        expect(item).not.toHaveProperty('status');
        expect(item.name).toBe('Mira H.');
      }
    });

    it('keyset pages cover every review once, for each sort', async () => {
      const t0 = Date.parse('2026-09-01T00:00:00Z');
      const ratings = [5, 3, 4, 5, 1, 2, 4, 5, 3, 4, 2];
      for (const [i, rating] of ratings.entries()) {
        // Two pairs share a timestamp, so the id tie-break is exercised.
        await review(PRODUCT, {rating, createdAt: new Date(t0 + Math.floor(i / 2) * 3600_000)});
      }
      for (const sort of ['newest', 'highest', 'lowest'] as const) {
        const seen: string[] = [];
        const order: number[] = [];
        let cursor: string | null = null;
        for (let pages = 0; pages < 10; pages++) {
          const q: string = `?sort=${sort}&pageSize=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
          const res = await new Browser(app).get(`${base}${q}`);
          expect(res.status).toBe(200);
          const body = res.json as {items: {id: string; rating: number}[]; nextCursor: string | null};
          seen.push(...body.items.map(r => r.id));
          order.push(...body.items.map(r => r.rating));
          cursor = body.nextCursor;
          if (!cursor) break;
        }
        expect(new Set(seen).size).toBe(ratings.length);
        expect(seen).toHaveLength(ratings.length);
        if (sort === 'highest') expect(order).toEqual([...order].sort((a, b) => b - a));
        if (sort === 'lowest') expect(order).toEqual([...order].sort((a, b) => a - b));
      }
      // A garbage cursor starts from the top.
      const garbage = await new Browser(app).get(`${base}?cursor=zzz`);
      expect(garbage.status).toBe(200);
    });
  });

  describe('eligibility and submit', () => {
    let buyer: Browser;
    let buyerId: number;

    beforeEach(async () => {
      buyer = await signedIn(app, 'buyer@example.test', undefined, '203.0.113.21');
      buyerId = await userId('buyer@example.test');
      await paidOrder('buyer@example.test', PRODUCT, buyerId);
    }, 60_000);

    it('answers per visitor, privately', async () => {
      const guest = await new Browser(app).get(`${base}/eligibility`);
      expect(guest.json).toMatchObject({canReview: false, reason: 'signin', postingAs: null});
      const mine = await buyer.get(`${base}/eligibility`);
      expect(mine.headers.get('cache-control')).toContain('no-store');
      expect(mine.json).toMatchObject({canReview: true, reason: 'ok'});
      expect(typeof (mine.json as {postingAs: unknown}).postingAs).toBe('string');
      const other = await buyer.get(`/site-api/products/${OTHER}/reviews/eligibility`);
      expect(other.json).toMatchObject({canReview: false, reason: 'purchase'});
    });

    it('counts only paid orders', async () => {
      const shopper = await signedIn(app, 'refund@example.test', undefined, '203.0.113.22');
      await paidOrder('refund@example.test', OTHER, await userId('refund@example.test'), 'Refunded');
      expect((await shopper.get(`/site-api/products/${OTHER}/reviews/eligibility`)).json).toMatchObject({reason: 'purchase'});
    });

    it('matches guest orders by a verified email', async () => {
      await paidOrder('buyer@example.test', OTHER, null);
      expect((await buyer.get(`/site-api/products/${OTHER}/reviews/eligibility`)).json).toMatchObject({reason: 'ok'});
    });

    it('guests sign in, non-buyers are refused, bad bodies get field errors', async () => {
      expect((await new Browser(app).post(base, good)).status).toBe(401);
      const res = await buyer.post(`/site-api/products/${OTHER}/reviews`, good);
      expect(res.status).toBe(403);
      expect(res.json).toMatchObject({error: 'verified_only'});
      const bad = await buyer.post(base, {rating: 9, title: '', body: 'short'});
      expect(bad.status).toBe(422);
      expect(Object.keys((bad.json as {fields: object}).fields).sort()).toEqual(['body', 'rating', 'title']);
    });

    it('a pending review leaves the rating, then the second is a conflict', async () => {
      const res = await buyer.post(base, good);
      expect(res.status).toBe(201);
      expect(res.json).toEqual({status: 'pending', verifiedPurchase: true, review: null});
      const p = await db.product.findUniqueOrThrow({where: {id: PRODUCT}, select: {ratingCount: true}});
      expect(p.ratingCount).toBe(0);
      expect((await buyer.get(`${base}/eligibility`)).json).toMatchObject({reason: 'reviewed'});
      const again = await buyer.post(base, good);
      expect(again.status).toBe(409);
      expect(again.json).toMatchObject({error: 'already_reviewed'});
    });

    it('goes live at once without approval and updates the rating', async () => {
      await db.setting.update({where: {id: 1}, data: {reviewsRequireApproval: false}});
      const res = await buyer.post(base, {...good, rating: 4});
      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({status: 'approved', review: {rating: 4, title: good.title}});
      const p = await db.product.findUniqueOrThrow({where: {id: PRODUCT}, select: {ratingCount: true, ratingAvg: true}});
      expect(p.ratingCount).toBe(1);
      expect(Number(p.ratingAvg)).toBe(4);
    });

    it('closed reviews refuse writes', async () => {
      await db.setting.update({where: {id: 1}, data: {reviewsEnabled: false}});
      expect((await buyer.get(`${base}/eligibility`)).json).toMatchObject({reason: 'closed'});
      expect((await buyer.post(base, good)).status).toBe(403);
    });

    it('rate limits an account to 10 reviews an hour', async () => {
      for (let i = 0; i < 10; i++) {
        await db.review.create({
          data: {productId: OTHER, userId: buyerId, name: 'B', email: 'x@example.test', rating: 5, title: 't', body: 'body text here', status: 'pending'},
        });
      }
      const res = await buyer.post(base, good);
      expect(res.status).toBe(429);
    });
  });

  describe('admin moderation', () => {
    let staff: Browser;
    let customer: Browser;

    beforeEach(async () => {
      const owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
      staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.32');
      customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.33');
      const made = await owner.request('PUT', `/site-api/admin/users/${await userId('staff@example.test')}/roles`, {roles: ['member', 'staff']});
      expect(made.status).toBe(200);
    }, 90_000);

    it('is staff-only', async () => {
      expect((await customer.get('/site-api/manage/reviews')).status).toBe(403);
      expect((await staff.get('/site-api/manage/reviews')).status).toBe(200);
    });

    it('filters, orders the pending queue oldest first, counts across statuses', async () => {
      const t0 = Date.parse('2026-09-01T00:00:00Z');
      const old = await review(PRODUCT, {rating: 2, status: 'pending', createdAt: new Date(t0), title: 'Old pending'});
      const fresh = await review(PRODUCT, {rating: 5, status: 'pending', createdAt: new Date(t0 + 86_400_000), title: 'New pending'});
      await review(OTHER, {rating: 5, status: 'approved', title: 'Shirt fits'});
      await review(PRODUCT, {rating: 1, status: 'rejected'});
      const pending = (await staff.get('/site-api/manage/reviews?status=pending')).json as {items: {id: string}[]; counts: Record<string, number>};
      expect(pending.items.map(r => r.id)).toEqual([String(old.id), String(fresh.id)]);
      expect(pending.counts).toEqual({all: 4, pending: 2, approved: 1, rejected: 1});
      const fives = (await staff.get('/site-api/manage/reviews?status=all&rating=5')).json as {items: unknown[]; counts: Record<string, number>};
      expect(fives.items).toHaveLength(2);
      expect(fives.counts).toEqual({all: 2, pending: 1, approved: 1, rejected: 0});
      const q = (await staff.get('/site-api/manage/reviews?status=all&q=linen')).json as {items: {productName: string}[]};
      expect(q.items.map(r => r.productName)).toEqual(['Linen Shirt']);
    });

    it('PATCH approves and recomputes; reply-only does not', async () => {
      const r = await review(PRODUCT, {rating: 3, status: 'pending'});
      const res = await staff.request('PATCH', `/site-api/manage/reviews/${r.id}`, {status: 'approved'});
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({id: String(r.id), status: 'approved', productName: 'Atelier Wool Coat'});
      let p = await db.product.findUniqueOrThrow({where: {id: PRODUCT}, select: {ratingCount: true, ratingAvg: true}});
      expect([p.ratingCount, Number(p.ratingAvg)]).toEqual([1, 3]);

      const replied = await staff.request('PATCH', `/site-api/manage/reviews/${r.id}`, {reply: 'Thank you!'});
      expect(replied.json).toMatchObject({reply: 'Thank you!'});
      const cleared = await staff.request('PATCH', `/site-api/manage/reviews/${r.id}`, {reply: ''});
      expect(cleared.json).toMatchObject({reply: null});

      const nothing = await staff.request('PATCH', `/site-api/manage/reviews/${r.id}`, {});
      expect(nothing.status).toBe(422);
      expect((nothing.json as {fields: Record<string, string>}).fields.status).toBe('Nothing to change');
      expect((await staff.request('PATCH', '/site-api/manage/reviews/99999', {status: 'approved'})).status).toBe(404);
      expect((await staff.request('PATCH', '/site-api/manage/reviews/abc', {status: 'approved'})).status).toBe(404);

      await staff.request('PATCH', `/site-api/manage/reviews/${r.id}`, {status: 'rejected'});
      p = await db.product.findUniqueOrThrow({where: {id: PRODUCT}, select: {ratingCount: true, ratingAvg: true}});
      expect([p.ratingCount, p.ratingAvg]).toEqual([0, null]);
    });

    it('bulk approves and recomputes each product; bounds the ids', async () => {
      const a = await review(PRODUCT, {rating: 4, status: 'pending'});
      const b = await review(OTHER, {rating: 2, status: 'pending'});
      const res = await staff.post('/site-api/manage/reviews/bulk', {ids: [String(a.id), String(b.id)], action: 'approve'});
      expect(res.status).toBe(200);
      expect(res.json).toEqual({updated: 2});
      const ps = await db.product.findMany({where: {id: {in: [PRODUCT, OTHER]}}, select: {id: true, ratingCount: true}, orderBy: {id: 'asc'}});
      expect(ps.map(p => p.ratingCount)).toEqual([1, 1]);
      const tooMany = await staff.post('/site-api/manage/reviews/bulk', {ids: Array.from({length: 101}, (_, i) => String(i + 1)), action: 'reject'});
      expect(tooMany.status).toBe(422);
    });

    it('DELETE removes and recomputes; again is a 404', async () => {
      const r = await review(PRODUCT, {rating: 5});
      await staff.request('PATCH', `/site-api/manage/reviews/${r.id}`, {status: 'approved'});
      expect((await staff.request('DELETE', `/site-api/manage/reviews/${r.id}`)).status).toBe(204);
      const p = await db.product.findUniqueOrThrow({where: {id: PRODUCT}, select: {ratingCount: true}});
      expect(p.ratingCount).toBe(0);
      expect((await staff.request('DELETE', `/site-api/manage/reviews/${r.id}`)).status).toBe(404);
    });
  });
});
