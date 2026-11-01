import {describe, expect, it} from 'vitest';

import {afterCursor, cursorOf, displayName, listQuery, submitBody, summarize} from '../src/server/routes/reviews';
import {validateReviewsSearch} from '../src/portal/queries/reviews';

/** Product reviews (WP-04): the pure helpers behind /site-api/products/:slug/reviews. */

describe('displayName', () => {
  it('shows "First L."', () => {
    expect(displayName('Mira Holm')).toBe('Mira H.');
    expect(displayName('Ana de la Cruz')).toBe('Ana C.');
    expect(displayName('ana  lund')).toBe('ana L.');
  });
  it('keeps one word, falls back when empty, keeps an erased name', () => {
    expect(displayName('  mira  ')).toBe('mira');
    expect(displayName('')).toBe('VAREL customer');
    expect(displayName('   ')).toBe('VAREL customer');
    expect(displayName('Deleted customer')).toBe('Deleted customer');
  });
});

describe('summarize', () => {
  it('averages to 2 dp with the distribution', () => {
    expect(summarize([{rating: 5, count: 2}, {rating: 4, count: 1}])).toEqual({
      avg: 4.67,
      count: 3,
      distribution: {'1': 0, '2': 0, '3': 0, '4': 1, '5': 2},
    });
  });
  it('is zero with no reviews', () => {
    expect(summarize([])).toEqual({avg: 0, count: 0, distribution: {'1': 0, '2': 0, '3': 0, '4': 0, '5': 0}});
  });
});

describe('submitBody', () => {
  const ok = {rating: '3', title: 'Lovely', body: 'Warm and well made, fits true to size.'};
  const errors = (input: unknown) => {
    const r = submitBody.safeParse(input);
    return r.success ? {} : Object.fromEntries(r.error.issues.map(i => [String(i.path[0]), i.message]));
  };

  it('coerces the rating and trims text', () => {
    const r = submitBody.parse({...ok, title: '  Lovely  ', extra: 'dropped'});
    expect(r).toEqual({rating: 3, title: 'Lovely', body: ok.body});
  });
  it('rejects ratings outside 1–5 and fractions', () => {
    for (const rating of [0, 6, 2.5]) expect(errors({...ok, rating}).rating).toBe('Choose a rating from 1 to 5');
  });
  it('checks title and body lengths', () => {
    expect(errors({...ok, title: ''}).title).toBeTruthy();
    expect(errors({...ok, title: 'x'.repeat(121)}).title).toBeTruthy();
    expect(errors({...ok, body: 'Too short'}).body).toBe('Write at least a sentence or two');
    expect(errors({...ok, body: 'x'.repeat(2001)}).body).toBeTruthy();
    expect(errors(ok)).toEqual({});
  });
});

describe('list query', () => {
  it('defaults and bounds', () => {
    expect(listQuery.parse({})).toEqual({page: 1, pageSize: 5, sort: 'newest'});
    expect(listQuery.safeParse({pageSize: '21'}).success).toBe(false);
    expect(listQuery.safeParse({sort: 'oldest'}).success).toBe(false);
  });
});

describe('keyset cursors', () => {
  const row = {rating: 4, createdAt: new Date('2026-10-01T10:00:00.000Z'), id: 7};

  it('round-trips per sort', () => {
    expect(afterCursor('newest', cursorOf('newest', row))).toEqual({
      OR: [{createdAt: {lt: row.createdAt}}, {createdAt: row.createdAt, id: {lt: 7}}],
    });
    expect(afterCursor('highest', cursorOf('highest', row))).toEqual({
      OR: [{rating: {lt: 4}}, {rating: 4, createdAt: {lt: row.createdAt}}, {rating: 4, createdAt: row.createdAt, id: {lt: 7}}],
    });
    expect(afterCursor('lowest', cursorOf('lowest', row))).toEqual({
      OR: [{rating: {gt: 4}}, {rating: 4, createdAt: {lt: row.createdAt}}, {rating: 4, createdAt: row.createdAt, id: {lt: 7}}],
    });
  });

  it('treats garbage or a cursor of another sort as the first page', () => {
    expect(afterCursor('newest', undefined)).toEqual({});
    expect(afterCursor('newest', 'not-a-cursor')).toEqual({});
    expect(afterCursor('highest', cursorOf('newest', row))).toEqual({});
    expect(afterCursor('newest', cursorOf('highest', row))).toEqual({});
  });
});

describe('dashboard search', () => {
  it('keeps known values and drops the rest (no page: keyset)', () => {
    expect(validateReviewsSearch({status: 'approved', rating: '4', q: ' coat ', page: '3'})).toEqual({status: 'approved', rating: 4, q: 'coat'});
    expect(validateReviewsSearch({status: 'nope', rating: '9'})).toEqual({});
  });
});
