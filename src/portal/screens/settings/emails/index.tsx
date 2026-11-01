import {ScreenPlaceholder} from '../../../ui';

/**
 * settings/emails screens — STUB from F5 (the screen registry). WP-22 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/emails/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/settings/emails`. */
export function Emails() {
  return <ScreenPlaceholder title="Emails" description="Email templates, sent log, provider and sender." />;
}
