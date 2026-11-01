/* The search page's one analytics event (VAREL src/lib/analytics.ts `useTrackSearch` → `track('search', …)`).
   WP-16 owns the storefront beacon (`src/components/layout/analytics.ts`: queue, batches, pagehide flush); until
   it lands this sends the single event itself, with the same rules: nothing without analytics consent, never
   throws, never blocks the page. When WP-16's `track()` exists, replace the body with
   `track('search', event)` (docs/migration/handoff/WP-08.md, Requests). */
import {hasConsent} from '@/lib/stores/consent';
import {siteFetch} from '@/platform/browser';

export function trackSearch(event: {query: string; results: number}): void {
  try {
    if (typeof window === 'undefined' || !hasConsent('analytics')) return;
    const path = (location.pathname + location.search).slice(0, 300);
    void siteFetch('/site-api/events', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({events: [{type: 'search', path, ...event}]}),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // analytics must never break the page
  }
}
