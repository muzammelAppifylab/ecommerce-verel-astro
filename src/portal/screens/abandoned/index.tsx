import {ScreenPlaceholder} from '../../ui';

/**
 * abandoned screens — STUB from F5 (the screen registry). WP-24 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/abandoned/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/abandoned`. */
export function AbandonedBags() {
  return <ScreenPlaceholder title="Abandoned bags" description="Bags with pieces and an email address that never reached an order. Only a shopper's newest bag gets a reminder, with a link that restores it." />;
}
