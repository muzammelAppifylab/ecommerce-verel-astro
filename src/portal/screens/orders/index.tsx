import {ScreenPlaceholder} from '../../ui';

/**
 * orders screens — STUB from F5 (the screen registry). WP-19 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/orders/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/orders`. */
export function OrdersList() {
  return <ScreenPlaceholder title="Orders" description="Every order, newest first: payment, fulfilment, refunds and CSV export." />;
}

/** `/dashboard/orders/$number`. */
export function OrderDetail() {
  return <ScreenPlaceholder title="Order" description="One order: items, payment, fulfilment, refunds and its history." />;
}
