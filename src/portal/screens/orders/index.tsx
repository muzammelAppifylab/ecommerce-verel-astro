/**
 * Orders screens (WP-19, port of VAREL src/pages/admin/orders/*). src/portal/routes.tsx
 * lazy-loads these named exports; the screens' CSS is `./screen.css` (bundled by App.astro).
 */
export {OrdersList} from './OrdersList';
export {OrderDetail} from './OrderDetail';
