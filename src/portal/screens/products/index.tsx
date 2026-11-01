/**
 * Products screens (WP-17): port of VAREL `src/pages/admin/products/*` (VariantsSection: WP-18).
 * src/portal/routes.tsx lazy-loads these names; the screen's CSS is `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 *
 *   /dashboard/products       ProductsList
 *   /dashboard/products/new   NewProduct
 *   /dashboard/products/$id   EditProduct
 */
export {EditProduct, NewProduct} from './EditProduct';
export {ProductsList} from './ProductsList';
