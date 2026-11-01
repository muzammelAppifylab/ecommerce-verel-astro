import {ScreenPlaceholder} from '../../ui';

/**
 * customers screens — STUB from F5 (the screen registry). WP-20 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/customers/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/customers`. */
export function CustomersList() {
  return <ScreenPlaceholder title="Customers" description="Customer accounts, their orders and what they spent." />;
}

/** `/dashboard/customers/$id`. */
export function CustomerDetail() {
  return <ScreenPlaceholder title="Customer" description="One customer: details, addresses, orders, privacy requests." />;
}
