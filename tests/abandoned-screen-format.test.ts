import {describe, expect, it} from 'vitest';

import type {AbandonedBagRow} from '../src/lib/types/admin/merchandising';
import {abandonedCsv, csvCell} from '../src/portal/screens/abandoned/csv';
import {ago, bulkText, hourOptions, remindableOf} from '../src/portal/screens/abandoned/format';

const NOW = Date.UTC(2026, 10, 1, 12);
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('ago', () => {
  it('reads like VAREL', () => {
    expect(ago(minsAgo(0), NOW)).toBe('Just now');
    expect(ago(minsAgo(1), NOW)).toBe('Just now');
    expect(ago(minsAgo(12), NOW)).toBe('12 minutes ago');
    expect(ago(minsAgo(60), NOW)).toBe('1 hour ago');
    expect(ago(minsAgo(60 * 47), NOW)).toBe('47 hours ago');
    expect(ago(minsAgo(60 * 72), NOW)).toBe('3 days ago');
    expect(ago(minsAgo(-5), NOW)).toBe('Just now');
  });
});

describe('bulkText', () => {
  it('sent with skips', () => {
    expect(bulkText({action: 'remind', done: 3, skipped: {superseded: 2, ordered: 1}})).toBe('3 reminders sent · 3 skipped (2 older bags, 1 already ordered)');
  });
  it('nothing done', () => {
    expect(bulkText({action: 'dismiss', done: 0, skipped: {missing: 1}})).toBe('No bags dismissed · 1 skipped (1 gone)');
    expect(bulkText({action: 'restore', done: 1, skipped: {}})).toBe('1 bag restored');
  });
});

describe('hourOptions', () => {
  it('adds a non-standard current value', () => {
    expect(hourOptions(24)).toHaveLength(8);
    expect(hourOptions(36).at(-1)).toEqual({value: '36', label: 'After 36 hours'});
  });
});

const row = (o: Partial<AbandonedBagRow>): AbandonedBagRow => ({
  id: '1',
  email: 'a@example.com',
  customerName: null,
  userId: null,
  value: 12.5,
  itemCount: 2,
  items: [{name: 'Coat', meta: 'Stone · M', qty: 2, total: 12.5, image: {src: 'x', credit: '', creditHref: ''} as never, productId: '3'}],
  createdAt: '2026-11-01T10:00:00.000Z',
  lastActivity: '2026-11-01T11:00:00.000Z',
  reminderSentAt: null,
  dismissedAt: null,
  status: 'abandoned',
  ...o,
});

describe('CSV', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@me')).toBe("'@me");
    expect(csvCell(-3)).toBe('-3');
  });
  it('header and rows', () => {
    const text = abandonedCsv([row({customerName: '-Ann'})]);
    const [head, line] = text.split('\n');
    expect(head).toBe('Email,Customer,Status,Value,Pieces,Items,Started,Last activity,Reminder sent');
    expect(line).toBe("a@example.com,'-Ann,Due a reminder,12.50,2,2 × Coat (Stone · M),2026-11-01T10:00:00.000Z,2026-11-01T11:00:00.000Z,");
  });
});

describe('remindableOf', () => {
  it('never older, dismissed or ordered bags', () => {
    const rows = (['active', 'abandoned', 'reminded', 'superseded', 'dismissed', 'ordered'] as const).map((status, i) => row({id: String(i), status}));
    expect(remindableOf(rows).map(r => r.status)).toEqual(['active', 'abandoned', 'reminded']);
  });
});
