import {type AuthSettings, DEFAULT_AUTH_SETTINGS} from '../platform/auth';

/**
 * How sign-in works on THIS site (yours to edit; the auth core in
 * `src/platform/auth/` reads it). Every option is explained in
 * `src/platform/auth/settings.ts` and docs/agent/auth.md.
 *
 * VAREL (WP-15): customers create their own accounts on `/account/register/`
 * (VAREL's Signup), confirm their email, and get the `member` role; staff get
 * `staff` / `admin` from the dashboard's Users screen (D5).
 *
 * `afterSignInPath` stays `/dashboard`: it is where the owner's one-click
 * sign-in (no `next`) lands. The storefront sign-in pages always pass their
 * own `next`, whose fallback is the customer account (`/account/`,
 * src/components/auth/next.ts).
 *
 * Who may become owner: The platform hands the live site the account owner's
 * email at each Publish (`SITE_OWNER_EMAILS`); add more addresses in
 * `ownerEmails`. On the live site, with no owner email at all, nobody becomes
 * owner (the first person to sign up never does).
 */
export const authSettings: AuthSettings = {
  ...DEFAULT_AUTH_SETTINGS,
  registration: 'open',
  requireEmailVerification: true,
  defaultRole: 'member',
  afterSignInPath: '/dashboard',
  // ownerEmails: ['owner@example.com'],
};
