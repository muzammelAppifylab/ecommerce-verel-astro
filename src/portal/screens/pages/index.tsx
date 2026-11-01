/**
 * Pages screens (WP-07): the port of VAREL `src/pages/admin/pages/*`. src/portal/routes.tsx lazy-loads
 * these export names; the screen's CSS is `./screen.css` (bundled by src/layouts/App.astro).
 *
 *   /dashboard/pages       PagesList   the editable pages (privacy, terms, /pages/<slug>/)
 *   /dashboard/pages/$id   PageEditor  title, visibility, words, SEO, live preview
 */
export {PagesList} from './PagesList';
export {PageEditor} from './PageEditor';
