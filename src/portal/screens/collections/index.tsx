/**
 * Collections screens (WP-05): the port of VAREL `src/pages/admin/collections/*`. `src/portal/routes.tsx`
 * lazy-loads these names; styles in `./screen.css` (bundled by src/layouts/App.astro).
 *
 *   /dashboard/collections                  CollectionsList
 *   /dashboard/collections/$id              CollectionEditor (`new` creates one)
 *   /dashboard/collections/category-order   CategoryOrder
 */
export {CategoryOrder} from './CategoryOrder';
export {CollectionEditor} from './CollectionEditor';
export {CollectionsList} from './CollectionsList';
