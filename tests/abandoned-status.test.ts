import {describe, expect, it} from 'vitest';

import type {AbandonedBagRow} from '../src/lib/types/admin/merchandising';
import {decodeCursor, encodeCursor} from '../src/server/lib/http';
import {bagStatus, customerNameOf, olderBagIds, sliceAfter, sortRows, valueOf} from '../src/server/routes/admin/abandoned-scan';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 1, 12);
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR);

type Bag = Parameters<typeof bagStatus>[0] & {email: string | null; user: null | {id: number; email: string; name: string; status: string; customerProfile: null}};
const bag = (id: number, o: Partial<Bag> & {lineAgo?: number[]} = {}): Bag => ({
  id,
  email: 'a@example.com',
  user: null,
  createdAt: at(100),
  updatedAt: at(50),
  reminderSentAt: null,
  dismissedAt: null,
  lines: (o.lineAgo ?? [40]).map(h => ({createdAt: at(h)})),
  ...o,
});

describe('bagStatus (VAREL precedence)', () => {
  const none = new Set<number>();
  it('ordered beats everything', () => {
    const b = bag(1, {dismissedAt: at(1), reminderSentAt: at(1)});
    expect(bagStatus(b, 24, NOW, new Set([1]), at(10).getTime())).toBe('ordered');
  });
  it('an order before the newest line is not "ordered"', () => {
    expect(bagStatus(bag(1), 24, NOW, none, at(45).getTime())).toBe('abandoned');
  });
  it('dismissed > superseded > reminded', () => {
    expect(bagStatus(bag(1, {dismissedAt: at(1), reminderSentAt: at(1)}), 24, NOW, new Set([1]))).toBe('dismissed');
    expect(bagStatus(bag(1, {reminderSentAt: at(1)}), 24, NOW, new Set([1]))).toBe('superseded');
    expect(bagStatus(bag(1, {reminderSentAt: at(1)}), 24, NOW, none)).toBe('reminded');
  });
  it('idle exactly `hours` is abandoned, less is active', () => {
    expect(bagStatus(bag(1, {updatedAt: at(24), lineAgo: [30]}), 24, NOW, none)).toBe('abandoned');
    expect(bagStatus(bag(1, {updatedAt: at(23), lineAgo: [30]}), 24, NOW, none)).toBe('active');
    // A recent line counts as activity even when the cart row is old.
    expect(bagStatus(bag(1, {updatedAt: at(80), lineAgo: [2]}), 24, NOW, none)).toBe('active');
  });
  it('a reminder or dismissal older than the newest line no longer counts', () => {
    expect(bagStatus(bag(1, {reminderSentAt: at(45), lineAgo: [40]}), 24, NOW, none)).toBe('abandoned');
    expect(bagStatus(bag(1, {dismissedAt: at(45), lineAgo: [40]}), 24, NOW, none)).toBe('abandoned');
  });
});

describe('olderBagIds (superseded)', () => {
  it('keeps only the newest bag per lower-cased contact email', () => {
    const bags = [
      bag(1, {email: 'Sam@Example.com', lineAgo: [50]}),
      bag(2, {email: 'sam@example.com', lineAgo: [5]}),
      bag(3, {email: null, user: {id: 9, email: 'SAM@example.com', name: 'Sam', status: 'active', customerProfile: null}, updatedAt: at(60), lineAgo: [60]}),
      bag(4, {email: 'other@example.com'}),
    ];
    expect([...olderBagIds(bags)].sort()).toEqual([1, 3]);
  });
  it('ignores bags without lines or without a contact', () => {
    const bags = [
      bag(1, {lineAgo: []}),
      bag(2, {lineAgo: [3]}),
      bag(3, {email: null, user: {id: 1, email: 'x@y.invalid', name: '', status: 'active', customerProfile: null}}),
    ];
    expect(olderBagIds(bags).size).toBe(0);
  });
});

describe('row helpers', () => {
  it('value is price × qty without discounts, 2 dp', () => {
    expect(valueOf({lines: [{qty: 2, variant: {priceCents: 1999}}, {qty: 1, variant: {priceCents: 1}}]} as never)).toBe(39.99);
  });
  it('customer name: profile, else account name, never anonymised', () => {
    const u = (email: string, first: string | null, name: string) => ({
      user: {id: 1, email, name, status: 'active', customerProfile: first === null ? null : {firstName: first, lastName: 'Lee'}},
    });
    expect(customerNameOf(u('a@b.c', 'Ana', 'x') as never)).toBe('Ana Lee');
    expect(customerNameOf(u('a@b.c', null, ' Ana B ') as never)).toBe('Ana B');
    expect(customerNameOf(u('a@b.invalid', 'Ana', 'x') as never)).toBeNull();
    expect(customerNameOf({user: null} as never)).toBeNull();
  });
});

const row = (id: number, value: number, hoursAgo: number): AbandonedBagRow => ({
  id: String(id),
  email: `${id}@example.com`,
  customerName: null,
  userId: null,
  value,
  itemCount: 1,
  items: [],
  createdAt: at(hoursAgo).toISOString(),
  lastActivity: at(hoursAgo).toISOString(),
  reminderSentAt: null,
  dismissedAt: null,
  status: 'abandoned',
});

describe('sortRows + sliceAfter (keyset over derived rows)', () => {
  const rows = [row(1, 10, 5), row(2, 10, 3), row(3, 50, 3), row(4, 5, 9), row(5, 10, 1)];

  it('sorts by value with the id as tie-breaker in the same direction', () => {
    expect(sortRows(rows, '-value').map(r => r.id)).toEqual(['3', '5', '2', '1', '4']);
    expect(sortRows(rows, 'value').map(r => r.id)).toEqual(['4', '1', '2', '5', '3']);
    expect(sortRows(rows, '-lastActivity').map(r => r.id)).toEqual(['5', '3', '2', '1', '4']);
  });

  it('walks every row once, page by page', () => {
    for (const sort of ['-value', 'value', 'lastActivity', '-lastActivity'] as const) {
      const sorted = sortRows(rows, sort);
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = sliceAfter(sorted, sort, cursor, 2);
        seen.push(...page.items.map(r => r.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual(sorted.map(r => r.id));
    }
  });

  it('continues after a cursor row that disappeared', () => {
    const sorted = sortRows(rows, '-value');
    const first = sliceAfter(sorted, '-value', undefined, 2);
    expect(first.items.map(r => r.id)).toEqual(['3', '5']);
    const without5 = sorted.filter(r => r.id !== '5');
    expect(sliceAfter(without5, '-value', first.nextCursor!, 2).items.map(r => r.id)).toEqual(['2', '1']);
  });

  it('a bad or foreign cursor starts from the top', () => {
    const sorted = sortRows(rows, '-value');
    expect(sliceAfter(sorted, '-value', 'garbage', 2).items[0]!.id).toBe('3');
    const timeCursor = encodeCursor([rows[0]!.lastActivity, 1]);
    expect(sliceAfter(sorted, '-value', timeCursor, 2).items[0]!.id).toBe('3');
  });

  it('pages of 100 and the cursor shape', () => {
    const many = Array.from({length: 150}, (_, i) => row(i + 1, i, i));
    const page = sliceAfter(sortRows(many, '-value'), '-value', undefined, 100);
    expect(page.items).toHaveLength(100);
    expect(decodeCursor(page.nextCursor)).toEqual([50, 51]);
    expect(sliceAfter(sortRows(many, '-value'), '-value', page.nextCursor!, 100).items).toHaveLength(50);
  });
});
