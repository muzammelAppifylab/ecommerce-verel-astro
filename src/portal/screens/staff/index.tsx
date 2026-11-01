import {ScreenPlaceholder} from '../../ui';

/**
 * staff screens — STUB from F5 (the screen registry). WP-26 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/staff/StaffPage.tsx, AccessFields.tsx`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/staff`. */
export function StaffPage() {
  return <ScreenPlaceholder title="Staff" description="The people who run the store, their access areas and pending invites." />;
}
