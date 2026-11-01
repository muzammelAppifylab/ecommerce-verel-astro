import {ScreenPlaceholder} from '../../ui';

/**
 * reviews screens — STUB from F5 (the screen registry). WP-04 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/reviews/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/reviews`. */
export function Reviews() {
  return <ScreenPlaceholder title="Reviews" description="Product reviews waiting for approval, and the ones live on the store." />;
}
