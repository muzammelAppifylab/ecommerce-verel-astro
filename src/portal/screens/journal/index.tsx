import {ScreenPlaceholder} from '../../ui';

/**
 * journal screens — STUB from F5 (the screen registry). WP-06 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/journal/*`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/journal`. */
export function JournalList() {
  return <ScreenPlaceholder title="Journal" description="Editorial posts on the storefront." />;
}

/** `/dashboard/journal/new`. */
export function NewPost() {
  return <ScreenPlaceholder title="New post" description="Title, body blocks, cover and SEO." />;
}

/** `/dashboard/journal/$slug`. */
export function EditPost() {
  return <ScreenPlaceholder title="Post" description="Title, body blocks, cover and SEO." />;
}
