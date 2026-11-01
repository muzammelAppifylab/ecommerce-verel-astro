import {ScreenPlaceholder} from '../../ui';

/**
 * catalog screens — STUB from F5 (the screen registry). WP-18 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/catalog/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/catalog`. */
export function Departments() {
  return <ScreenPlaceholder title="Departments" description="Departments and their categories: the shop menu and the catalog pages." />;
}
