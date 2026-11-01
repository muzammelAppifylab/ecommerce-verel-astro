import {ScreenPlaceholder} from '../../ui';

/**
 * discounts screens — STUB from F5 (the screen registry). WP-21 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/discounts/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/discounts`. */
export function DiscountsPage() {
  return <ScreenPlaceholder title="Discounts" description="Codes customers enter, and automatic offers that apply on their own." />;
}

/** `/dashboard/discounts/new`. */
export function NewDiscount() {
  return <ScreenPlaceholder title="New discount" description="Amount off the order or products, buy X get Y, or free shipping." />;
}

/** `/dashboard/discounts/$id`. */
export function EditDiscount() {
  return <ScreenPlaceholder title="Discount" description="Its settings, its codes and how it performed." />;
}
