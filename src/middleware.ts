import {defineMiddleware} from 'astro:middleware';

import {DEFAULT_LOCALE, LOCALE_HEADER, splitLocalePath} from './lib/i18n/locales';
import {SELF_FETCH_HEADER} from './platform/api';
import {config} from './platform/config';
import {forwardPlatformFiles, PLATFORM_FILES_PREFIX} from './platform/files';
import {applySecurityHeaders} from './platform/headers';
import {inRequestScope} from './platform/request-scope';

/**
 * Runs before every on-demand page and every `/site-api` call:
 *
 * 1. Opens the request's memo (`src/platform/request-scope.ts`), so the
 *    visitor and the Site Database client are made once per request.
 * 2. Stops a page from fetching ITSELF forever: on your own machine there is
 *    no platform behind `/api`, so a server-side fetch there would land on
 *    this site's 404 page, which fetches the brand again… Every server-side
 *    platform fetch carries `SELF_FETCH_HEADER`, and such a request is
 *    answered here with a bare 404.
 * 3. In the editor Preview and on your own machine, hands file uploads and public file links
 *    (`/__platform/files/*`) to the platform, which answers them itself when deployed
 *    (`src/platform/files.ts`).
 * 4. Storefront languages (PLAN.md D7): `/da/shop/` renders `src/pages/shop/` with
 *    `Astro.locals.locale = 'da'` (a rewrite, so page files stay locale-agnostic and the
 *    visitor keeps the prefixed URL; `Astro.originPathname` is the prefixed path). The
 *    rewritten request carries `X-Locale`, so in-process Site API calls answer in that
 *    language. `/en/…` redirects to the bare path (English has no prefix). Unprefixed
 *    pages are English. A localised page must render on demand: a rewrite cannot reach
 *    a prerendered page, so such a request is sent to the English page instead.
 * 5. Adds the security headers (`src/platform/headers.ts`).
 */
export const onRequest = defineMiddleware((context, next) =>
  inRequestScope(async () => {
    if (context.url.pathname.startsWith('/api/') && context.request.headers.has(SELF_FETCH_HEADER)) {
      return new Response(JSON.stringify({error: 'not_found'}), {
        status: 404,
        headers: {'content-type': 'application/json'},
      });
    }
    if (
      context.url.pathname.startsWith(PLATFORM_FILES_PREFIX) &&
      (config.preview || import.meta.env.DEV)
    ) {
      return forwardPlatformFiles(context.request, context.url);
    }

    const {pathname} = context.url;
    if (pathname === '/en' || pathname.startsWith('/en/')) {
      const bare = pathname.slice(3) || '/';
      return applySecurityHeaders(context.redirect(`${bare}${context.url.search}`, 301), context.url);
    }

    const {locale, path} = splitLocalePath(pathname);
    context.locals.locale = locale ?? DEFAULT_LOCALE;
    if (!locale) return applySecurityHeaders(await next(), context.url);

    // "/da" → "/da/": public URLs end with a slash (AGENTS.md).
    if (pathname === `/${locale}`) {
      return applySecurityHeaders(context.redirect(`/${locale}/${context.url.search}`, 301), context.url);
    }

    const target = new URL(`${path}${context.url.search}`, context.url);
    let response: Response;
    try {
      response = await next(localeRequest(context.request, target, locale));
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ForbiddenRewrite') throw error;
      // A prerendered page has one (English) body: send the visitor there.
      response = context.redirect(`${path}${context.url.search}`, 302);
    }
    return applySecurityHeaders(response, context.url);
  })
);

/** The request for the locale-agnostic path, with `X-Locale` so the Site API answers in that language. */
function localeRequest(request: Request, url: URL, locale: string): Request {
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: request.redirect,
    signal: request.signal,
    ...(hasBody ? {duplex: 'half'} : {}),
  } as RequestInit);
}
