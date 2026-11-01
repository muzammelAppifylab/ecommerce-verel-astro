import {describe, expect, it} from 'vitest';

import {chartBuckets, DAY, dayStart, isoDate, isRealDate, resolvePeriod, resolveRange} from '../src/server/routes/admin/analytics';
import {InputError} from '../src/server/lib/validate';

const today = dayStart('2026-10-22');

function fieldError(fn: () => unknown): Record<string, string> | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof InputError) return (e as unknown as {fields: Record<string, string>}).fields;
    throw e;
  }
  return undefined;
}

describe('chartBuckets', () => {
  it('one bucket per day up to 92 days, oldest first', () => {
    const c = chartBuckets(today - 29 * DAY, today + DAY);
    expect(c.bucket).toBe('day');
    expect(c.map.size).toBe(30);
    const keys = [...c.map.keys()];
    expect(keys[0]).toBe('2026-09-23');
    expect(keys.at(-1)).toBe('2026-10-22');
    expect(chartBuckets(today - 91 * DAY, today + DAY).bucket).toBe('day');
  });

  it('month buckets dated the 1st beyond 92 days', () => {
    const c = chartBuckets(dayStart('2026-01-15'), today + DAY);
    expect(c.bucket).toBe('month');
    const keys = [...c.map.keys()];
    expect(keys[0]).toBe('2026-01-01');
    expect(keys.at(-1)).toBe('2026-10-01');
    expect(keys).toHaveLength(10);
    expect(c.keyOf(new Date('2026-03-31T23:59:00Z'))).toBe('2026-03-01');
  });

  it('end is exclusive', () => {
    const c = chartBuckets(today, today + DAY);
    expect([...c.map.keys()]).toEqual(['2026-10-22']);
  });
});

describe('isRealDate', () => {
  it('rejects impossible and malformed days', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2026-02-31')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('26-1-1')).toBe(false);
  });
});

describe('resolveRange', () => {
  it('defaults to the last 30 days including today', () => {
    const r = resolveRange({}, today);
    expect(r.days).toBe(30);
    expect(isoDate(new Date(r.start))).toBe('2026-09-23');
    expect(r.end).toBe(today + DAY);
    expect(r.lifetime).toBe(false);
  });

  it('presets 7 and 90', () => {
    expect(resolveRange({days: '7'}, today).days).toBe(7);
    expect(resolveRange({days: '90'}, today).days).toBe(90);
  });

  it('from only runs to today; to only takes the 30 days before it', () => {
    const a = resolveRange({from: '2026-10-01'}, today);
    expect(a.custom).toBe(true);
    expect(a.days).toBe(22);
    const b = resolveRange({to: '2026-06-30'}, today);
    expect(isoDate(new Date(b.end - DAY))).toBe('2026-06-30');
    expect(b.days).toBe(30);
  });

  it('a custom range wins over days, and one day is allowed', () => {
    const r = resolveRange({from: '2026-10-05', to: '2026-10-05', days: '90'}, today);
    expect(r.days).toBe(1);
    expect(r.custom).toBe(true);
  });

  it('refuses a start after the end and a range over a year', () => {
    expect(fieldError(() => resolveRange({from: '2026-10-10', to: '2026-10-01'}, today))).toEqual({from: 'Start on or before the end date'});
    expect(fieldError(() => resolveRange({from: '2025-01-01', to: '2026-01-02'}, today))).toEqual({from: 'Choose a range of a year or less'});
    expect(fieldError(() => resolveRange({from: '2025-01-01', to: '2025-12-31'}, today))).toBeUndefined();
  });

  it('the lifetime extends to the first activity, never shortens, and skips the year cap', () => {
    const near = resolveRange({days: 'all'}, today, today - 3 * DAY);
    expect(near.days).toBe(30);
    expect(near.lifetime).toBe(true);
    const far = resolveRange({days: 'all'}, today, dayStart('2024-05-01') + 5 * 3600_000);
    expect(isoDate(new Date(far.start))).toBe('2024-05-01');
    expect(far.days).toBeGreaterThan(366);
  });
});

describe('resolvePeriod', () => {
  it('7, 30, 90 or 30 for anything else', () => {
    expect(resolvePeriod('7', today).period).toBe(7);
    expect(resolvePeriod('90', today).period).toBe(90);
    expect(resolvePeriod('x', today).period).toBe(30);
    expect(resolvePeriod(undefined, today).period).toBe(30);
    const w = resolvePeriod('30', today);
    expect(w.end - w.start).toBe(30 * DAY);
    expect(w.start - w.prevStart).toBe(30 * DAY);
  });

  it('the lifetime starts on the first order day, or today without one', () => {
    const w = resolvePeriod('all', today, new Date('2026-10-01T15:00:00Z'));
    expect(w.lifetime).toBe(true);
    expect(w.period).toBe(22);
    expect(isoDate(new Date(w.start))).toBe('2026-10-01');
    expect(w.prevStart).toBe(w.start);
    const none = resolvePeriod('all', today, null);
    expect(none.period).toBe(1);
    expect(none.start).toBe(today);
  });
});
