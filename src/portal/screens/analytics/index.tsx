import {ScreenPlaceholder} from '../../ui';

/**
 * analytics screens — STUB from F5 (the screen registry). WP-16 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/analytics/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/analytics`. */
export function Analytics() {
  return <ScreenPlaceholder title="Analytics" description="Traffic, conversion, revenue by department and what shoppers search for." />;
}
