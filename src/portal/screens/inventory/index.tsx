import {ScreenPlaceholder} from '../../ui';

/**
 * inventory screens — STUB from F5 (the screen registry). WP-18 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/inventory/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/inventory`. */
export function Inventory() {
  return <ScreenPlaceholder title="Inventory" description="Stock per variant · physical products only." />;
}
