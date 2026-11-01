import {ScreenPlaceholder} from '../../ui';

/**
 * pages screens — STUB from F5 (the screen registry). WP-07 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/pages/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/pages`. */
export function PagesList() {
  return <ScreenPlaceholder title="Pages" description="The words on the store's own pages: privacy, terms and the rest. New pages are designed and built in code." />;
}

/** `/dashboard/pages/$id`. */
export function PageEditor() {
  return <ScreenPlaceholder title="Page" description="The page's title, words and SEO." />;
}
