import {ScreenPlaceholder} from '../../ui';

/**
 * collections screens — STUB from F5 (the screen registry). WP-05 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/collections/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/collections`. */
export function CollectionsList() {
  return <ScreenPlaceholder title="Collections" description="Curated sets of products with their own page. Drag to set the order on the storefront and the home page." />;
}

/** `/dashboard/collections/$id`. */
export function CollectionEditor() {
  return <ScreenPlaceholder title="Collection" description="Its page, its products and their order." />;
}

/** `/dashboard/collections/category-order`. */
export function CategoryOrder() {
  return <ScreenPlaceholder title="Category order" description="Set the order products appear in on a category page when shoppers sort by Featured." />;
}
