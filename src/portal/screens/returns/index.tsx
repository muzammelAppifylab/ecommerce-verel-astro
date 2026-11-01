import {ScreenPlaceholder} from '../../ui';

/**
 * returns screens — STUB from F5 (the screen registry). WP-19 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/returns/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/returns`. */
export function ReturnsList() {
  return <ScreenPlaceholder title="Returns" description="Return requests from customers, newest first." />;
}

/** `/dashboard/returns/$id`. */
export function ReturnDetail() {
  return <ScreenPlaceholder title="Return" description="One return: the items, the reason, approve, receive and refund." />;
}
