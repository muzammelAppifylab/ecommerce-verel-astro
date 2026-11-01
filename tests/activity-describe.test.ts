import {Hono} from 'hono';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const create = vi.fn();
const fakeDb = {activityLog: {create}, product: {findUnique: vi.fn(async () => ({name: 'Atelier Wool Coat'}))}};
vi.mock('../src/platform/db', () => ({getDb: () => fakeDb}));

const {activityLogMiddleware, describe: describeWrite, fieldList, segmentsOf, writeActivity} = await import(
  '../src/server/routes/admin/activity-describe'
);
const {csvLine} = await import('../src/server/routes/admin/activity');

type Case = [method: string, path: string, body: Record<string, unknown>, result: Record<string, unknown> | null, pre: string | null, action: string | null, summary?: string];

const d = (method: string, path: string, body: Record<string, unknown> = {}, result: Record<string, unknown> | null = null, pre: string | null = null) =>
  describeWrite({method, segs: segmentsOf(`/site-api/manage/${path}`), body, result, pre});

describe('activity describe (VAREL wording on the /manage paths)', () => {
  const cases: Case[] = [
    ['POST', 'products', {name: 'Coat'}, {id: 'p1', name: 'Coat'}, null, 'product.create', 'Created product Coat'],
    ['PATCH', 'products/p1', {price: 1, stock: 2, id: 'x', updatedAt: 'y'}, {name: 'Coat'}, null, 'product.update', 'Updated product Coat · price, stock'],
    ['DELETE', 'products/p1', {}, {archived: true}, 'Coat', 'product.archive', 'Archived product Coat (it has orders)'],
    ['DELETE', 'products/p1', {}, null, 'Coat', 'product.delete', 'Deleted product Coat'],
    ['POST', 'products/p1/duplicate', {}, {id: 'p2', name: 'Coat (copy)'}, 'Coat', 'product.duplicate', 'Duplicated product Coat as Coat (copy)'],
    ['PATCH', 'collections/product-order', {category: '12', productIds: ['a', 'b', 'c']}, null, null, 'product.reorder', 'Reordered 3 products in a category'],
    ['POST', 'inventory/bulk', {updates: [{}, {}]}, null, null, 'inventory.bulk', 'Updated stock for 2 variants'],
    ['PATCH', 'inventory/v1', {adjust: 5}, null, 'Coat · Black · M', 'inventory.update', 'Stock for Coat · Black · M · adjusted by +5'],
    ['POST', 'taxonomy/departments', {name: 'Women'}, {id: 3, name: 'Women'}, null, 'department.create', 'Created department Women'],
    ['DELETE', 'taxonomy/categories/4', {}, null, 'Coats', 'category.delete', 'Deleted category Coats'],
    ['POST', 'orders/VRL-1001/refund', {restock: true}, {number: 'VRL-1001', events: [{message: 'Refunded $588.38 to the card'}]}, null, 'order.refund', 'Refunded order VRL-1001 · $588.38 · restocked'],
    ['PATCH', 'orders/VRL-1001', {fulfillment: 'Shipped', carrier: 'DHL', tracking: '123'}, {number: 'VRL-1001'}, null, 'order.update', 'Updated order VRL-1001 · marked shipped, tracking DHL 123'],
    ['PATCH', 'settings', {a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1}, null, null, 'settings.update', 'Changed settings · a, b, c, d, e, f, g, h and 1 more'],
    ['POST', 'tax-rates', {country: 'DK', rate: 0.25}, {id: 1, country: 'DK'}, null, 'taxRate.create', 'Added tax rate for DK · 25%'],
    ['PATCH', 'staff/7', {roles: ['staff', 'editor']}, {name: 'Ada'}, 'Ada', 'staff.update', 'Changed access for Ada · roles staff, editor'],
    ['DELETE', 'staff/7', {}, null, 'Ada', 'staff.remove', 'Removed staff access for Ada'],
    ['POST', 'staff/invite', {email: 'New@Varel.studio', roles: ['staff']}, {status: 'invited', roleNames: ['Staff'], areas: ['orders', 'products']}, null, 'staff.invite', 'Invited new@varel.studio as Staff · orders, products'],
    ['POST', 'staff/invite', {email: 'a@b.co', roles: ['admin']}, {status: 'granted', roleNames: ['Admin'], areas: []}, null, 'staff.grant', 'Gave a@b.co access as Admin'],
    ['POST', 'emails/templates/order_confirmation/test', {to: 'me@x.co'}, null, null, 'email.test', 'Sent a test order_confirmation email to me@x.co'],
    ['POST', 'emails/templates/order_confirmation/reset', {}, null, null, 'email.template.reset', 'Reset email template order_confirmation to the default'],
    ['POST', 'emails/templates/order_confirmation/preview', {}, null, null, null],
    ['POST', 'abandoned/run', {}, null, null, 'cart.reminders.run', 'Ran abandoned bag reminders now'],
    ['POST', 'abandoned/c1/remind', {}, {email: 'x@y.co'}, null, 'cart.remind', 'Sent an abandoned bag reminder to x@y.co'],
    ['POST', 'abandoned/bulk', {ids: ['a', 'b'], action: 'remind'}, null, null, 'cart.bulk', 'Updated 2 abandoned bags · remind'],
    ['POST', 'reviews/bulk', {ids: [1, 2, 3], status: 'APPROVED'}, null, null, 'review.bulk', 'Updated 3 reviews · marked approved'],
    ['PATCH', 'reviews/4', {status: 'approved'}, null, 'Lovely', 'review.moderate', 'Marked review Lovely approved'],
    ['DELETE', 'reviews/4', {}, null, 'Lovely', 'review.delete', 'Deleted review Lovely'],
    ['DELETE', 'discounts/5', {}, {deactivated: true}, 'Summer', 'discount.deactivate', 'Deactivated discount Summer (it was used)'],
    ['POST', 'discounts/5/codes', {count: 10}, null, 'Summer', 'discount.codes.create', 'Generated 10 codes for discount Summer'],
    ['DELETE', 'subscribers/a%40b.co', {}, null, null, 'subscriber.delete', 'Removed subscriber a@b.co'],
    ['POST', 'posts', {title: 'Hello'}, {slug: 'hello', title: 'Hello'}, null, 'post.create', 'Created post Hello'],
    ['PATCH', 'posts/hello', {status: 'published'}, {title: 'Hello'}, null, 'post.publish', 'Published post Hello'],
    ['PUT', 'translations/product/12', {fields: {}}, null, null, 'translations.update'],
    ['POST', 'translations/retranslate', {}, null, null, 'translations.retranslate', 'Retranslate · translation'],
    ['POST', 'uploads', {}, null, null, null],
  ];

  it.each(cases)('%s %s', (method, path, body, result, pre, action, summary) => {
    const e = d(method, path, body, result, pre);
    if (action === null) return expect(e).toBeNull();
    expect(e?.action).toBe(action);
    if (summary) expect(e?.summary).toBe(summary);
  });

  it('drops numeric and cuid-like segments from the default branch', () => {
    const e = d('PUT', 'menus/main/items/12', {label: 'Shop'});
    expect(e?.action).toBe('menus.items');
    expect(e?.summary).not.toContain('12');
  });

  it('strips /taxonomy and the base path', () => {
    expect(segmentsOf('/site-api/manage/taxonomy/departments/3')).toEqual(['departments', '3']);
    expect(segmentsOf('/site-api/manage/staff/invite')).toEqual(['staff', 'invite']);
  });

  it('fieldList ignores ids, slugs and timestamps and caps at 6', () => {
    expect(fieldList({id: 1, slug: 's', createdAt: 1, updatedAt: 1, name: 1})).toBe('name');
    expect(fieldList({a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1})).toBe('a, b, c, d, e, f and 1 more');
  });
});

describe('recordActivity body (writeActivity)', () => {
  beforeEach(() => create.mockReset());

  it('truncates every column and collapses whitespace', async () => {
    await writeActivity(fakeDb as never, {id: 3, name: ' Ada '}, 'x'.repeat(80), {entity: 'e'.repeat(50), id: 'i'.repeat(200)}, {summary: ` a \n\n b ${'s'.repeat(600)}`});
    const data = create.mock.calls[0]![0].data;
    expect(data.userId).toBe(3);
    expect(data.actorName).toBe('Ada');
    expect(data.action).toHaveLength(60);
    expect(data.entity).toHaveLength(40);
    expect(data.entityId).toHaveLength(120);
    expect(data.summary.startsWith('a b s')).toBe(true);
    expect(data.summary).toHaveLength(500);
  });

  it("writes 'System' for no actor and the action when there is no summary", async () => {
    await writeActivity(fakeDb as never, null, 'cart.reminders.run', {entity: 'cart', id: ''});
    expect(create.mock.calls[0]![0].data).toMatchObject({userId: null, actorName: 'System', entityId: null, summary: 'cart.reminders.run'});
  });

  it('never throws', async () => {
    create.mockRejectedValueOnce(new Error('down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(writeActivity(fakeDb as never, null, 'a.b', {entity: 'a'})).resolves.toBeUndefined();
    expect(spy.mock.calls[0]!.join(' ')).not.toContain('down');
    spy.mockRestore();
  });
});

describe('activity middleware', () => {
  const app = new Hono<{Variables: {viewer: unknown}}>()
    .use('*', async (c, next) => {
      c.set('viewer', {state: 'user', id: 9, name: 'Ada', email: 'ada@x.co', emailVerified: true});
      await next();
    })
    .use('*', activityLogMiddleware('/site-api/manage'))
    .get('/site-api/manage/products', c => c.json({items: []}))
    .patch('/site-api/manage/products/:id', async c => {
      const body = (await c.req.json()) as {price?: number};
      return body.price === -1 ? c.json({error: 'invalid_input'}, 422) : c.json({id: c.req.param('id'), name: 'Coat', echoed: body});
    })
    .post('/site-api/manage/uploads', c => c.json({id: 'u'}))
    .post('/site-api/manage/posts', c => c.json({slug: 'x', title: 'X'}));

  const send = (method: string, path: string, body?: string, type = 'application/json') =>
    app.request(path, {method, headers: body === undefined ? {} : {'content-type': type}, body});

  beforeEach(() => create.mockReset());

  it('records a successful write with the viewer as actor; the handler still reads its body', async () => {
    const res = await send('PATCH', '/site-api/manage/products/p1', JSON.stringify({price: 5}));
    expect(((await res.json()) as {echoed: unknown}).echoed).toEqual({price: 5});
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data).toMatchObject({userId: 9, actorName: 'Ada', action: 'product.update', summary: 'Updated product Coat · price'});
  });

  it('skips reads, failures and uploads', async () => {
    await send('GET', '/site-api/manage/products');
    await send('PATCH', '/site-api/manage/products/p1', JSON.stringify({price: -1}));
    await send('POST', '/site-api/manage/uploads', '{}');
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a body that is not JSON as empty', async () => {
    await send('POST', '/site-api/manage/posts', 'title=X', 'application/x-www-form-urlencoded');
    expect(create.mock.calls[0]![0].data).toMatchObject({action: 'post.create', summary: 'Created post X'});
  });
});

describe('activity CSV lines', () => {
  it('encodes ISO dates, quotes, the formula guard and CRLF', () => {
    const line = csvLine({
      createdAt: new Date('2026-10-01T10:00:00Z'),
      actorName: 'Ada, "the admin"',
      action: 'inventory.update',
      entity: 'inventory',
      entityId: null,
      summary: '-5 stock',
    });
    expect(line).toBe('2026-10-01T10:00:00.000Z,"Ada, ""the admin""",inventory.update,inventory,,\'-5 stock\r\n');
  });
});
