/* Storefront analytics beacon (WP-16; VAREL src/lib/analytics.ts, docs/PHASE2-3.md §8, PLAN.md D11).
   track() queues events and sends them in batches of up to 20 to POST /site-api/events. Nothing is queued without
   hasConsent('analytics'), and dashboard pages are never tracked. The server adds the visitor id and the user,
   and drops everything when analytics is off in the store settings. Purchases are counted from orders, so there
   is no purchase event.

   Transport: `siteFetch(…, {keepalive: true})`, never `navigator.sendBeacon` (the Site API's CSRF check needs a
   header a beacon cannot carry, and siteFetch also carries the editor Preview's cookies). The CSRF token is
   fetched on the first event so it is ready when the page is hidden.

   Page views: importing this module registers ONE `astro:page-load` listener (the first load and every
   client-side navigation of <ClientRouter />). Islands call `track('product_view', {productId})`,
   `track('add_to_cart', {productId})`, `track('checkout_start')`, `track('search', {query, results})`. */
import {csrfToken, siteFetch} from '@/platform/browser';
import {hasConsent} from '@/lib/stores/consent';
import type {EventType, TrackedEvent} from '@/lib/types/events';

export type {EventType} from '@/lib/types/events';

export interface TrackProps {
  path?: string;
  productId?: string;
  query?: string;
  results?: number;
}

export const MAX_BATCH = 20;
export const FLUSH_MS = 2000;
/** The same event (type, path, product, query) within this window is dropped (double mounts, re-renders). */
export const DEDUPE_MS = 1000;
const PATH_MAX = 300;

/** Never tracked: the dashboard and its old address. */
const SKIP = /^\/(dashboard|portal|admin)(\/|$|\?)/;
/** Query parameters that may carry a secret (reset / verify / recovery links): removed from tracked paths. */
const PRIVATE_PARAMS = ['token', 'email', 'code'];

/** `pathname + search` without private parameters, at most 300 characters. */
export function cleanPath(pathname: string, search = ''): string {
  let query = '';
  if (search && search !== '?') {
    const sp = new URLSearchParams(search);
    for (const k of PRIVATE_PARAMS) sp.delete(k);
    const s = sp.toString();
    query = s ? `?${s}` : '';
  }
  return (pathname + query).slice(0, PATH_MAX);
}

export interface TrackerDeps {
  send(batch: TrackedEvent[]): void;
  now(): number;
  consent(): boolean;
  /** Run `fn` after `ms`; returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
  /** The current page's path (with its query), or undefined outside a browser. */
  path(): string | undefined;
}

/** The queue, batching and dedupe, free of browser globals (unit-tested in tests/analytics-beacon.test.ts). */
export function createTracker(deps: TrackerDeps) {
  let queue: TrackedEvent[] = [];
  let cancel: (() => void) | undefined;
  let last = {key: '', at: 0};

  function flush(): void {
    cancel?.();
    cancel = undefined;
    while (queue.length) {
      const batch = queue.splice(0, MAX_BATCH);
      try {
        deps.send(batch);
      } catch {
        // analytics must never break the page
      }
    }
  }

  function track(type: EventType, props: TrackProps = {}): void {
    try {
      if (!deps.consent()) return;
      const raw = props.path ?? deps.path();
      if (raw && SKIP.test(raw)) return;
      let path: string | undefined;
      if (raw) {
        const q = raw.indexOf('?');
        path = q < 0 ? raw.slice(0, PATH_MAX) : cleanPath(raw.slice(0, q), raw.slice(q));
      }
      const key = `${type}|${path ?? ''}|${props.productId ?? ''}|${props.query ?? ''}`;
      const now = deps.now();
      if (key === last.key && now - last.at < DEDUPE_MS) return;
      last = {key, at: now};
      const event: TrackedEvent = {type};
      if (path) event.path = path;
      if (props.productId) event.productId = props.productId.slice(0, 120);
      if (props.query !== undefined) event.query = props.query.slice(0, 120);
      if (props.results !== undefined && Number.isInteger(props.results) && props.results >= 0) event.results = Math.min(props.results, 100_000);
      queue.push(event);
      if (queue.length >= MAX_BATCH) flush();
      else if (!cancel) cancel = deps.schedule(flush, FLUSH_MS);
    } catch {
      // analytics must never break the page
    }
  }

  return {track, flush, pending: () => queue.length};
}

// ─── Browser wiring ──────────────────────────────────────────────────────────

const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
let warmed = false;

function send(batch: TrackedEvent[]): void {
  void siteFetch('/site-api/events', {
    method: 'POST',
    keepalive: true,
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({events: batch}),
  }).catch(() => undefined);
}

const tracker = createTracker({
  send,
  now: () => Date.now(),
  consent: () => {
    if (!inBrowser || !hasConsent('analytics')) return false;
    if (!warmed) {
      warmed = true;
      void csrfToken().catch(() => null); // ready before the page is hidden
    }
    return true;
  },
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  path: () => (inBrowser ? cleanPath(location.pathname, location.search) : undefined),
});

/** Record one storefront event. Safe to call anywhere (a no-op on the server); never throws. */
export function track(type: EventType, props?: TrackProps): void {
  tracker.track(type, props);
}

/** One page view for `path` (the layout calls it on every `astro:page-load`). */
export function trackPageView(path: string): void {
  track('page_view', {path});
}

/** Send everything queued now (also runs when the tab is hidden or closed). */
export function flush(): void {
  tracker.flush();
}

declare global {
  interface Window {
    __varelAnalytics?: boolean;
  }
}

// Listeners once per document, however many bundles import this module.
if (inBrowser && !window.__varelAnalytics) {
  window.__varelAnalytics = true;
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  document.addEventListener('astro:page-load', () => trackPageView(location.pathname));
}
