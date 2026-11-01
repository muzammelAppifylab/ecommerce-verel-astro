import {ScreenPlaceholder} from '../../ui';

/**
 * products screens — STUB from F5 (the screen registry). WP-17 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/products/* (VariantsSection: WP-18)`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/products`. */
export function ProductsList() {
  return <ScreenPlaceholder title="Products" description="Catalog, pricing and status." />;
}

/** `/dashboard/products/new`. */
export function NewProduct() {
  return <ScreenPlaceholder title="New product" description="Details, media, pricing, variants and inventory." />;
}

/** `/dashboard/products/$id`. */
export function EditProduct() {
  return <ScreenPlaceholder title="Product" description="Details, media, pricing, variants and inventory." />;
}
