/**
 * Returns screens (WP-19, port of VAREL src/pages/admin/returns/*). src/portal/routes.tsx
 * lazy-loads these named exports; the screens' CSS is `./screen.css` (bundled by App.astro).
 */
export {ReturnsList} from './ReturnsList';
export {ReturnDetail} from './ReturnDetail';
