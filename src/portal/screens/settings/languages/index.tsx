import {ScreenPlaceholder} from '../../../ui';

/**
 * settings/languages screens — STUB from F5 (the screen registry). WP-25 owns this folder and
 * replaces these bodies with the port of VAREL `src/pages/admin/translations/*, settings/LanguagesSettings.tsx`, keeping the
 * export names (src/portal/routes.tsx imports them lazily). Split into files as
 * needed and re-export them here; the screen's CSS goes in `./screen.css`
 * (src/layouts/App.astro bundles every screen.css under src/portal/screens).
 */

/** `/dashboard/settings/languages`. */
export function Languages() {
  return <ScreenPlaceholder title="Languages" description="Storefront languages and every translation." />;
}
