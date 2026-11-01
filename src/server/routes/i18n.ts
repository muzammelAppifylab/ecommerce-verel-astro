import {Hono} from 'hono';
import {setCookie} from 'hono/cookie';
import {z} from 'zod';

import {localizedPath} from '../../lib/i18n/locales';
import type {OnboardingResult} from '../../lib/types/account';
import {requireAuth, withDb, withViewer} from '../../platform/guards';
import {mergeGuestIntoUser} from '../lib/cart';
import {sendTemplate} from '../lib/contracts';
import {localizeFields, localizeMessage} from '../lib/i18n/messages';
import {notImplemented} from '../lib/http';
import {LOCALE_COOKIE, localeOf, localeSettings} from '../lib/locale';
import {applyNewsletterOptIn, ensureCustomerProfile, isNewAccount, NAME_MAX, rememberLocale} from '../lib/onboarding';
import {invalidInput, json} from '../lib/validate';
import {readVisitorId} from '../lib/visitor';

/**
 * Storefront i18n. WP-15 (PATCH /account/locale, POST /account/onboarding), WP-25 (catalogs) implements (docs/migration/PLAN.md §5).
 * Port of VAREL worker/routes/i18n.ts: VAREL `/api/<path>` is `/site-api/<path>` here, same shapes
 * (src/lib/types/*), errors as `{error, message, fields?}` (src/server/lib/http.ts).
 *
 *   GET    /site-api/i18n/catalog/:locale/:ns          I18nCatalogResponse (src/lib/types/events.ts)
 *   PATCH  /site-api/account/locale                    LocaleInput → {locale} (remember the language; sets the locale cookie; VAREL 200)
 *   POST   /site-api/account/onboarding                after a sign-in: CustomerProfile, sign-up extras, guest merge → OnboardingResult (WP-15)
 *
 * Several public modules share the `/account` mount prefix (WP-13's `accountRoutes`): never `.use('*')`
 * here, put middleware on each route. Per route: validator → withViewer → requireAuth → withDb.
 */
/** Mounted at `/site-api/i18n` (src/server/app.ts). WP-25 implements the catalog route. */
export const i18nRoutes = new Hono()
  .get('/catalog/:locale/:ns', notImplemented);

const ONE_YEAR_S = 31_536_000;

const localeSchema = z.object({
  locale: z.string({error: 'Choose a language'}).trim().toLowerCase().max(10, 'Choose a language').optional(),
});

const nameField = z
  .string()
  .trim()
  .max(NAME_MAX, `Keep this under ${NAME_MAX} characters`)
  .optional()
  .transform(v => v || undefined);

/**
 * What the sign-in pages kept from the sign-up form (src/components/auth/stash.ts): the template's
 * `register` takes only `{name, email, password}`. All optional: a plain sign-in sends `{}`.
 */
const onboardingSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, 'That email address is too long').optional(),
  firstName: nameField,
  lastName: nameField,
  newsletter: z.boolean().optional(),
});

/** Mounted at `/site-api/account` (src/server/app.ts). */
export const accountLocaleRoutes = new Hono()
  /**
   * Remember the signed-in customer's language (emails use it) and set the `varel_locale` cookie
   * (not HttpOnly: the browser's language switcher writes the same cookie). No body → the request's
   * language (X-Locale → ?lang → cookie → Accept-Language → store default). Only enabled languages.
   */
  .patch('/locale', json(localeSchema), withViewer, requireAuth, withDb, async c => {
    const input = c.req.valid('json');
    const viewer = c.var.viewer;
    const db = c.var.db;
    const locale = input.locale || (await localeOf(c));
    const {locales} = await localeSettings(db);
    if (!locales.includes(locale)) {
      const requestLocale = c.req.header('x-locale');
      const fields = {locale: 'Choose one of the store languages'};
      const body =
        requestLocale && requestLocale !== 'en'
          ? invalidInput(localizeFields(requestLocale, fields) ?? fields, localizeMessage(requestLocale, 'Check the highlighted fields'))
          : invalidInput(fields);
      return c.json(body, 422);
    }
    await rememberLocale(db, {id: viewer.id!, name: viewer.name}, locale);
    setCookie(c, LOCALE_COOKIE, locale, {
      path: '/',
      maxAge: ONE_YEAR_S,
      sameSite: 'Lax',
      secure: new URL(c.req.url).protocol === 'https:',
    });
    return c.json({locale}, 200);
  })
  /**
   * After any sign-in on the `/account/*` pages (password, emailed code, two-step, sign-up without
   * email confirmation). Idempotent; the pages ignore its errors. Replaces what VAREL's own
   * `/auth/signup` and `/auth/login` did besides signing in.
   */
  .post('/onboarding', json(onboardingSchema), withViewer, requireAuth, withDb, async c => {
    const input = c.req.valid('json');
    const viewer = c.var.viewer;
    const db = c.var.db;
    const userId = viewer.id!;
    const email = (viewer.email ?? '').toLowerCase();
    // The sign-up extras are kept per browser: only for the account they were typed for.
    const extras = !!input.email && !!email && input.email === email;
    const locale = await localeOf(c);

    const {profile, created} = await ensureCustomerProfile(
      db,
      {id: userId, name: viewer.name},
      {firstName: extras ? input.firstName : undefined, lastName: extras ? input.lastName : undefined, locale}
    );

    let subscribed = false;
    if (extras && input.newsletter === true) {
      await applyNewsletterOptIn(db, userId, email);
      subscribed = true;
    }

    const visitorId = readVisitorId(c);
    if (visitorId) await mergeGuestIntoUser(db, visitorId, userId);

    if (created && email) {
      const user = await db.user.findUnique({where: {id: userId}, select: {createdAt: true}});
      if (isNewAccount(user?.createdAt)) {
        const origin = new URL(c.req.url).origin;
        await sendTemplate(
          db,
          'welcome',
          email,
          {firstName: profile.firstName, accountUrl: `${origin}${localizedPath('/account/', profile.locale)}`},
          {requestUrl: c.req.url, related: {type: 'user', id: String(userId)}, locale: profile.locale}
        );
      }
    }

    const result: OnboardingResult = {profileCreated: created, subscribed, merged: !!visitorId};
    return c.json(result, 200);
  });
