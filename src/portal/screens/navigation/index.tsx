import {ScreenPlaceholder} from '../../ui';

/**
 * navigation screens — STUB from F5 (the screen registry). WP-07 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/navigation/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/navigation`. */
export function Navigation() {
  return <ScreenPlaceholder title="Navigation" description="Header and footer links, and the hero at the top of the home page." />;
}
