import {describe, expect, it} from 'vitest';

import {cleanPath, createTracker, DEDUPE_MS, FLUSH_MS, MAX_BATCH} from '../src/components/layout/analytics';
import type {TrackedEvent} from '../src/lib/types/events';

function setup(opts: {consent?: boolean; path?: string; throws?: boolean} = {}) {
  const sent: TrackedEvent[][] = [];
  let clock = 1_000_000;
  const timers: {fn: () => void; at: number; cancelled: boolean}[] = [];
  const tracker = createTracker({
    send: batch => {
      if (opts.throws) throw new Error('offline');
      sent.push(batch);
    },
    now: () => clock,
    consent: () => opts.consent ?? true,
    schedule: (fn, ms) => {
      const t = {fn, at: clock + ms, cancelled: false};
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    path: () => opts.path ?? '/shop/',
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers) if (!t.cancelled && t.at <= clock) {
      t.cancelled = true;
      t.fn();
    }
  };
  return {tracker, sent, advance};
}

describe('analytics beacon', () => {
  it('sends nothing without consent', () => {
    const {tracker, sent, advance} = setup({consent: false});
    tracker.track('page_view');
    advance(FLUSH_MS);
    tracker.flush();
    expect(sent).toEqual([]);
    expect(tracker.pending()).toBe(0);
  });

  it('sends one event after the flush delay, with the current path', () => {
    const {tracker, sent, advance} = setup();
    tracker.track('product_view', {productId: 'p1'});
    advance(FLUSH_MS - 1);
    expect(sent).toHaveLength(0);
    advance(1);
    expect(sent).toEqual([[{type: 'product_view', path: '/shop/', productId: 'p1'}]]);
  });

  it('sends a full batch at once and chunks a flush by 20', () => {
    const a = setup();
    for (let i = 0; i < MAX_BATCH; i++) a.tracker.track('page_view', {path: `/p${i}/`});
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0]).toHaveLength(MAX_BATCH);

    const b = setup();
    // Below MAX_BATCH each time, so nothing goes before flush… except the automatic batches at 20.
    for (let i = 0; i < 45; i++) b.tracker.track('page_view', {path: `/p${i}/`});
    b.tracker.flush();
    expect(b.sent.map(s => s.length)).toEqual([20, 20, 5]);
  });

  it('drops the same event within a second, keeps it after', () => {
    const {tracker, sent, advance} = setup();
    tracker.track('product_view', {productId: 'p1'});
    tracker.track('product_view', {productId: 'p1'});
    advance(DEDUPE_MS);
    tracker.track('product_view', {productId: 'p1'});
    tracker.flush();
    expect(sent.flat()).toHaveLength(2);
  });

  it('never tracks dashboard pages', () => {
    const {tracker} = setup({path: '/dashboard/orders'});
    tracker.track('page_view');
    tracker.track('page_view', {path: '/portal/'});
    expect(tracker.pending()).toBe(0);
  });

  it('clips paths and strips private parameters', () => {
    const {tracker, sent} = setup();
    tracker.track('page_view', {path: '/' + 'a'.repeat(400)});
    tracker.track('page_view', {path: '/account/reset/?token=abc&email=a%40b.c&x=1'});
    tracker.flush();
    expect(sent[0]![0]!.path).toHaveLength(300);
    expect(sent[0]![1]!.path).toBe('/account/reset/?x=1');
    expect(cleanPath('/verify/', '?code=123')).toBe('/verify/');
  });

  it('keeps search terms and results, and never throws when sending fails', () => {
    const ok = setup();
    ok.tracker.track('search', {query: 'linen', results: 3});
    ok.tracker.flush();
    expect(ok.sent[0]![0]).toMatchObject({type: 'search', query: 'linen', results: 3});

    const bad = setup({throws: true});
    expect(() => {
      for (let i = 0; i < 25; i++) bad.tracker.track('page_view', {path: `/x${i}/`});
      bad.tracker.flush();
    }).not.toThrow();
  });
});
