/* Request locale for the Site API (port of VAREL worker/middleware/locale.ts, PLAN.md D7):
   X-Locale header (set by src/middleware.ts on localised pages and sent by islands) → ?lang= → varel_locale
   cookie → Accept-Language → Setting.defaultLocale, restricted to the enabled Setting.locales.
   `withLocale` sets `c.var.locale` (mount it after `withDb`); routes that run without it call `localeOf(c)`.
   The enabled list is cached per isolate for a minute (public data; settings writes call
   invalidateLocaleSettings()). */
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, SHIPPED_LOCALES, baseLocale } from '../../lib/i18n/locales'
import type { Db } from './db'

export { LOCALE_COOKIE, LOCALE_HEADER }
export const FALLBACK_LOCALES: string[] = [...SHIPPED_LOCALES]

export function pickLocale(candidates: (string | null | undefined)[], enabled: string[], fallback: string): string {
  for (const c of candidates) {
    const b = baseLocale(c)
    if (b && enabled.includes(b)) return b
  }
  return fallback
}

/** Accept-Language → tags ordered by q (ties keep header order). */
export function acceptLanguages(header: string | null | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) || 0 : 1, i }
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag)
}

export interface LocaleSettings {
  defaultLocale: string
  locales: string[]
}

const TTL_MS = 60_000
let cached: { at: number; value: LocaleSettings } | null = null

export function invalidateLocaleSettings(): void {
  cached = null
}

/** Enabled locales and the default (cached). Never throws: falls back to the shipped languages. */
export async function localeSettings(db: Db | null | undefined): Promise<LocaleSettings> {
  if (!db) return { defaultLocale: DEFAULT_LOCALE, locales: FALLBACK_LOCALES }
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  try {
    const s = await db.setting.findUnique({ where: { id: 1 }, select: { defaultLocale: true, locales: true } })
    const def = s?.defaultLocale || DEFAULT_LOCALE
    const list = s?.locales?.length ? s.locales : FALLBACK_LOCALES
    const value = { defaultLocale: def, locales: [def, ...list.filter((l) => l !== def)] }
    cached = { at: Date.now(), value }
    return value
  } catch (e) {
    console.error('[locale] could not read settings', e instanceof Error ? e.message : 'unknown error')
    return { defaultLocale: DEFAULT_LOCALE, locales: FALLBACK_LOCALES }
  }
}

type LocaleCtx = Context<{ Variables: { locale?: string; db?: Db } }>

/** The locale candidates of a request, in priority order. */
export function localeCandidates(c: Pick<Context, 'req'>): (string | undefined)[] {
  return [
    c.req.header(LOCALE_HEADER),
    c.req.query('lang'),
    getCookie(c as Context, LOCALE_COOKIE),
    ...acceptLanguages(c.req.header('Accept-Language')),
  ]
}

/** The request's locale: `c.var.locale` when `withLocale` ran, else resolved now (and remembered). */
export async function localeOf(c: Context): Promise<string> {
  const ctx = c as unknown as LocaleCtx
  const known = ctx.get('locale')
  if (known) return known
  const { defaultLocale, locales } = await localeSettings(ctx.get('db'))
  const locale = pickLocale(localeCandidates(c), locales, defaultLocale)
  ctx.set('locale', locale)
  return locale
}

/** Hono middleware: sets `c.var.locale`. Mount after the database middleware (`withDb`). */
export const withLocale: MiddlewareHandler = async (c, next) => {
  await localeOf(c)
  await next()
}
