/* The two product-page analytics events (VAREL src/lib/analytics.ts `track`, as used by the PDP):
   `product_view` once per product mount and `add_to_cart` after a successful add. Consent-gated (F2 consent
   store), batched for 2 s, sent to POST /site-api/events (WP-16) through siteFetch (CSRF header, keepalive).
   Never throws. WP-16 owns the storefront-wide beacon; when it lands, this module should re-export its
   `track` (Request in docs/migration/handoff/WP-03.md). */
import {siteFetch} from '@/platform/browser';
import {hasConsent} from '@/lib/stores/consent';
import type {EventType, TrackedEvent} from '@/lib/types/events';

const MAX_BATCH = 20;
const FLUSH_MS = 2000;

let queue: TrackedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
// StrictMode / a quick re-mount: drop an identical event within a second (VAREL).
let last = {key: '', at: 0};

const currentPath = () =>
  typeof location === 'undefined' ? undefined : (location.pathname + location.search).slice(0, 300);

function send(batch: TrackedEvent[]) {
  void siteFetch('/site-api/events', {
    method: 'POST',
    body: JSON.stringify({events: batch}),
    keepalive: true,
    headers: {'content-type': 'application/json'},
  }).catch(() => undefined);
}

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  while (queue.length) send(queue.splice(0, MAX_BATCH));
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** Record one storefront event. Safe to call anywhere; never throws. */
export function track(type: EventType, props: Omit<TrackedEvent, 'type'> = {}): void {
  try {
    if (typeof window === 'undefined' || !hasConsent('analytics')) return;
    const path = props.path ?? currentPath();
    const key = `${type}|${path}|${props.productId ?? ''}`;
    const now = Date.now();
    if (key === last.key && now - last.at < 1000) return;
    last = {key, at: now};
    listen();
    queue.push({type, ...props, ...(path ? {path} : {})});
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  } catch {
    // analytics must never break the page
  }
}
