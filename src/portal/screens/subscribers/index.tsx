import {ScreenPlaceholder} from '../../ui';

/**
 * subscribers screens — STUB from F5 (the screen registry). WP-20 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/subscribers/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/subscribers`. */
export function Subscribers() {
  return <ScreenPlaceholder title="Subscribers" description="Newsletter sign-ups from the storefront and checkout." />;
}
