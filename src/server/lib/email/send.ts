/* Transactional email: the ONE entry point every feature uses (port of VAREL worker/lib/email/send.ts, WP-22).

   sendTemplateImpl renders the template into the branded layout, stores an EmailMessage row and hands it to the
   configured provider (outbox / Resend / Postmark / EzyStudio / webhook). It never throws. Other packages call it
   through `sendTemplate` in src/server/lib/contracts.ts.

   How a message travels (VAREL used waitUntil; this site uses the platform's background jobs, PLAN.md D9):
   - outbox (the default): the row is `stored` at once. Nothing is delivered.
   - from a route (`requestUrl` given): the row is `queued` and a `send-email` job delivers it
     (src/server/jobs/send-email.ts). A refused job (rate limit, paused) leaves the row `queued`: the
     `send-email` sweep picks it up later. Never retried in a loop.
   - from a job (no `requestUrl`), admin test sends and resends: delivered inline, awaited (≤ 10 s each).
   - delivery claims the row first (`claimedAt`), so two runs of the same job never send twice at once;
     a retryable provider failure (network, timeout, 408, 429, 5xx) keeps it `queued` for the job's next try.

   Statuses: `stored` (outbox), `queued`, `sent`, `failed`, `skipped` (template turned off).
   The provider's API key is the owner secret EMAIL_API_KEY (config.ownerSecret), read at delivery time only. */
import { JobRejected, sendJob, type JobInfo } from '../../../platform/background'
import { config } from '../../../platform/config'
import type { Db } from '../db'
import { TEMPLATE_DEFAULTS, templateDefault } from './defaults'
import { EmailProviderError, isEmailProvider, type EmailProviderName, type OutgoingEmail, type ProviderConfig } from './provider'
import { PROVIDERS } from './providers'
import { renderEmail, type Brand, type Rendered } from './render'

export type { EmailTemplateKey } from './defaults'

export type EmailVars = Record<string, string | number | boolean | null | undefined | EmailVarRow[]>
/** Rows for line-item tables, e.g. order items: { name, meta, qty, total } */
export type EmailVarRow = Record<string, string | number | null>

export type EmailStatus = 'stored' | 'queued' | 'sent' | 'failed' | 'skipped'

export interface Related {
  type: string
  id: string
}

// ─── Settings and templates ─────────────────────────────────────────────────

export interface EmailSettings {
  storeName: string
  supportEmail: string
  provider: EmailProviderName
  config: ProviderConfig
  fromName: string
  fromAddress: string
  replyTo: string | null
  staffAlertEmail: string | null
  address: string
  returnWindowDays: number
  lowStockThreshold: number
  currency: string
  taxName: string
  defaultLocale: string
  locales: string[]
}

const SETTINGS_SELECT = {
  storeName: true,
  supportEmail: true,
  emailProvider: true,
  emailConfig: true,
  emailFromName: true,
  emailFromAddress: true,
  emailReplyTo: true,
  staffAlertEmail: true,
  legalName: true,
  businessAddress: true,
  returnWindowDays: true,
  lowStockThreshold: true,
  currency: true,
  taxName: true,
  defaultLocale: true,
  locales: true,
} as const

/** Provider config from the settings JSON: only the two known string fields. */
export function providerConfigOf(raw: unknown): ProviderConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: ProviderConfig = {}
  if (typeof r.endpoint === 'string' && r.endpoint.trim()) out.endpoint = r.endpoint.trim()
  if (typeof r.messageStream === 'string' && r.messageStream.trim()) out.messageStream = r.messageStream.trim()
  return out
}

/** Everything sending needs from settings, in ONE read (VAREL read the row twice per send). */
export async function loadEmailSettings(db: Db): Promise<EmailSettings> {
  const s = await db.setting.findUnique({ where: { id: 1 }, select: SETTINGS_SELECT })
  const provider = isEmailProvider(s?.emailProvider) ? s!.emailProvider : 'outbox'
  const defaultLocale = s?.defaultLocale || 'en'
  return {
    storeName: s?.storeName || 'VAREL',
    supportEmail: s?.supportEmail || 'care@varel.studio',
    provider,
    config: providerConfigOf(s?.emailConfig),
    fromName: s?.emailFromName || s?.storeName || 'VAREL',
    fromAddress: s?.emailFromAddress || s?.supportEmail || 'care@varel.studio',
    replyTo: s?.emailReplyTo || null,
    staffAlertEmail: s?.staffAlertEmail || null,
    address: [s?.legalName, s?.businessAddress].filter(Boolean).join(' · '),
    returnWindowDays: s?.returnWindowDays ?? 30,
    lowStockThreshold: s?.lowStockThreshold ?? 6,
    currency: s?.currency || 'USD',
    taxName: s?.taxName || 'Tax',
    defaultLocale,
    locales: [defaultLocale, ...(s?.locales ?? []).filter((l) => l !== defaultLocale)],
  }
}

/** Where staff alerts go: Settings → Email staff alert address, else the support address. */
export const staffAlertAddress = (s: EmailSettings) => s.staffAlertEmail || s.supportEmail

/** The stored template, else the built-in default; `stored` says whether a row exists (its `enabled` counts). */
export async function loadTemplate(db: Db, key: string): Promise<{ subject: string; body: string; enabled: boolean; stored: boolean } | null> {
  const row = await db.emailTemplate.findUnique({ where: { key }, select: { subject: true, body: true, enabled: true } })
  if (row) return { ...row, stored: true }
  const d = templateDefault(key)
  return d ? { subject: d.subject, body: d.body, enabled: true, stored: false } : null
}

/** Public origin for links: the site's address, else the request's origin, else none (link buttons drop out). */
export function originOf(requestUrl?: string | null): string {
  const site = config.siteUrl
  if (site) return site.replace(/\/+$/, '')
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin
    } catch {
      /* no origin */
    }
  }
  return ''
}

export const brandOf = (s: EmailSettings, origin: string, lang?: string): Brand => ({
  storeName: s.storeName,
  supportEmail: s.supportEmail,
  siteUrl: origin,
  address: s.address || undefined,
  lang,
})

/** Variables every template can use, unless the caller passes its own. */
export const commonVars = (s: EmailSettings, origin: string): EmailVars => ({
  storeName: s.storeName,
  supportEmail: s.supportEmail,
  siteUrl: origin,
  taxLabel: s.taxName,
})

export function render(tpl: { subject: string; body: string }, vars: EmailVars, s: EmailSettings, origin: string, lang?: string): Rendered {
  return renderEmail(tpl, { ...commonVars(s, origin), ...vars }, brandOf(s, origin, lang))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const validRecipient = (to: string) => to.length <= 254 && EMAIL_RE.test(to)

/** "m***@example.com": the only form an address ever takes in a log line. */
export const maskEmail = (to: string) => to.replace(/^(.).*(@.*)$/, '$1***$2')

const cut = (s: string | null | undefined, n: number) => (s == null ? null : s.slice(0, n))

// ─── Recipient language (order → order locale, account → profile locale, abandoned bag → cart locale) ──

const STAFF_TEMPLATES = new Set<string>(TEMPLATE_DEFAULTS.filter((t) => t.audience === 'staff').map((t) => t.key))
const intOf = (id: string) => (/^[1-9][0-9]{0,9}$/.test(id) && Number(id) <= 2_147_483_647 ? Number(id) : null)

/** The language a message goes out in. Staff templates always use the store default (the admin stays in English). */
export async function emailLocale(db: Db, s: EmailSettings, key: string, related: Related | null | undefined, explicit?: string): Promise<string> {
  const { defaultLocale, locales } = s
  if (STAFF_TEMPLATES.has(key)) return defaultLocale
  let found: string | null | undefined = explicit
  if (!found && related) {
    const { type, id } = related
    const n = intOf(id)
    if (type === 'order') {
      const where = n != null ? { id: n } : { number: id }
      found = (await db.shopOrder.findUnique({ where, select: { locale: true } }))?.locale
    } else if (type === 'return' && n != null) {
      found = (await db.returnRequest.findUnique({ where: { id: n }, select: { order: { select: { locale: true } } } }))?.order?.locale
    } else if (type === 'user' && n != null) {
      found = (await db.customerProfile.findUnique({ where: { userId: n }, select: { locale: true } }))?.locale
    } else if (type === 'cart' && n != null) {
      found = (await db.cart.findUnique({ where: { id: n }, select: { locale: true } }))?.locale
    }
  }
  return found && locales.includes(found) ? found : defaultLocale
}

/** The template's subject and body in `locale` (email_template translations), falling back per field to the source. */
export async function localizeTemplate<T extends { subject: string; body: string }>(db: Db, key: string, tpl: T, locale: string, defaultLocale: string): Promise<T> {
  if (locale === defaultLocale) return tpl
  const rows = await db.translation.findMany({
    where: { entity: 'email_template', entityId: key, locale, field: { in: ['subject', 'body'] } },
    select: { field: true, value: true },
    take: 2,
  })
  const t = (f: string) => rows.find((r) => r.field === f)?.value
  return { ...tpl, subject: t('subject') || tpl.subject, body: t('body') || tpl.body }
}

// ─── Counters (template stats kept on write, no per-request groupBy) ──────────

async function countSent(db: Db, template: string | null) {
  if (!template) return
  await db.emailTemplate
    .updateMany({ where: { key: template }, data: { sentCount: { increment: 1 }, lastSentAt: new Date() } })
    .catch(() => undefined)
}

async function countFailed(db: Db, template: string | null) {
  if (!template) return
  await db.emailTemplate
    .updateMany({ where: { key: template }, data: { failedCount: { increment: 1 }, lastSentAt: new Date() } })
    .catch(() => undefined)
}

// ─── Queue and deliver ──────────────────────────────────────────────────────

export interface QueueOptions {
  related?: Related | null
  replyTo?: string | null
  /** Use this subject/body instead of the stored template (admin test sends of unsaved drafts). No translation. */
  override?: { subject: string; body: string }
  /** Deliver inline and await the provider (admin test sends). */
  wait?: boolean
  /** Send even when the template is turned off (admin test sends). */
  force?: boolean
  /** Recipient language (else from `related`, else the store default). */
  locale?: string
  /** The current request's URL: the send goes to a `send-email` job. Without it delivery is inline. */
  requestUrl?: string
  /** Subject prefix, e.g. `[Test] ` for admin test sends. */
  subjectPrefix?: string
}

export interface QueueResult {
  id: number
  status: EmailStatus
  error: string | null
}

/** A readable name for the job label (never personal data). */
const templateName = (key: string | null) => (key ? (templateDefault(key)?.name ?? key) : 'Store')

/** Hand a queued row to the `send-email` job; a refused job leaves it queued for the sweep. */
async function dispatch(requestUrl: string, id: number, template: string | null): Promise<void> {
  try {
    await sendJob(requestUrl, 'send-email', { messageId: String(id) }, { key: `email-${id}`, label: `${templateName(template)} email`.slice(0, 120) })
  } catch (e) {
    const code = e instanceof JobRejected ? e.code : 'E_UNKNOWN'
    console.warn(`[email] message ${id} stays queued (job not accepted: ${code}); the send-email sweep delivers it`)
  }
}

/** Render, store and dispatch one templated email. Throws only for an unknown key or a database failure. */
export async function queueTemplate(db: Db, key: string, to: string, vars: EmailVars, opts: QueueOptions = {}): Promise<QueueResult> {
  const s = await loadEmailSettings(db)
  const stored = await loadTemplate(db, key)
  if (!stored && !opts.override) throw new Error(`Unknown email template "${key}"`)
  let tpl: { subject: string; body: string } = opts.override ?? stored!
  let lang = s.defaultLocale
  if (!opts.override) {
    lang = await emailLocale(db, s, key, opts.related, opts.locale)
    tpl = await localizeTemplate(db, key, tpl, lang, s.defaultLocale)
  }
  const origin = originOf(opts.requestUrl)
  const rendered = render(tpl, vars, s, origin, lang)
  const recipient = to.trim().toLowerCase()
  const replyTo = opts.replyTo?.trim() || null

  const base = {
    template: key,
    to: recipient.slice(0, 254),
    subject: `${opts.subjectPrefix ?? ''}${rendered.subject}`.slice(0, 300),
    html: rendered.html,
    text: rendered.text,
    provider: s.provider,
    relatedType: cut(opts.related?.type, 40),
    relatedId: cut(opts.related?.id, 60),
    replyTo: replyTo && validRecipient(replyTo.toLowerCase()) ? replyTo.slice(0, 254) : null,
  }
  if (!validRecipient(recipient)) {
    const row = await db.emailMessage.create({ data: { ...base, status: 'failed', error: 'No valid recipient address' }, select: { id: true } })
    await countFailed(db, key)
    return { id: row.id, status: 'failed', error: 'No valid recipient address' }
  }
  if (stored && stored.stored && !stored.enabled && !opts.force) {
    const row = await db.emailMessage.create({ data: { ...base, status: 'skipped', error: 'Template is turned off' }, select: { id: true } })
    return { id: row.id, status: 'skipped', error: 'Template is turned off' }
  }
  if (s.provider === 'outbox') {
    const row = await db.emailMessage.create({ data: { ...base, status: 'stored' }, select: { id: true } })
    await countSent(db, key)
    return { id: row.id, status: 'stored', error: null }
  }

  const row = await db.emailMessage.create({ data: { ...base, status: 'queued' }, select: { id: true } })
  if (!opts.wait && opts.requestUrl) {
    await dispatch(opts.requestUrl, row.id, key)
    const now = await db.emailMessage.findUnique({ where: { id: row.id }, select: { status: true, error: true } })
    return { id: row.id, status: (now?.status as EmailStatus) ?? 'queued', error: now?.error ?? null }
  }
  const r = await deliverMessage(db, row.id)
  return { id: row.id, status: r.status, error: r.error }
}

export interface DeliveryResult {
  status: EmailStatus
  error: string | null
  /** The job should throw so the platform tries again later (row kept `queued`). */
  retry?: boolean
  /** The store's setup is incomplete (no key, no endpoint): trying again cannot help. */
  config?: boolean
  /** Nothing was done: the row is missing, not queued, or another run holds it. */
  noop?: 'missing' | 'done' | 'claimed'
}

/** A claim older than this is a run that died: another run may take the row over. */
export const CLAIM_STALE_MS = 5 * 60_000

const MESSAGE_FOR_DELIVERY = {
  id: true,
  template: true,
  to: true,
  subject: true,
  html: true,
  text: true,
  status: true,
  error: true,
  replyTo: true,
  relatedType: true,
  relatedId: true,
} as const

/**
 * Deliver one `queued` row through the CURRENT provider and record the outcome. Safe to repeat
 * (at-least-once jobs): a row that is no longer queued, or that another run holds, is left alone.
 * `job` (from the send-email handler) decides whether a retryable failure stays queued for the next try.
 * Never throws for a provider failure.
 */
export async function deliverMessage(db: Db, id: number, job?: Pick<JobInfo, 'attempt' | 'maxAttempts'>): Promise<DeliveryResult> {
  const msg = await db.emailMessage.findUnique({ where: { id }, select: MESSAGE_FOR_DELIVERY })
  if (!msg) return { status: 'failed', error: null, noop: 'missing' }
  if (msg.status !== 'queued') return { status: msg.status as EmailStatus, error: msg.error, noop: 'done' }
  const now = new Date()
  const claim = await db.emailMessage.updateMany({
    where: { id, status: 'queued', OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }] },
    data: { claimedAt: now, attempts: { increment: 1 } },
  })
  if (claim.count === 0) return { status: 'queued', error: msg.error, noop: 'claimed' }

  const s = await loadEmailSettings(db)
  if (s.provider === 'outbox') {
    await db.emailMessage.update({ where: { id }, data: { status: 'stored', provider: 'outbox', claimedAt: null, error: null } })
    await countSent(db, msg.template)
    return { status: 'stored', error: null }
  }
  const related = msg.relatedType && msg.relatedId ? { type: msg.relatedType, id: msg.relatedId } : null
  const outgoing: OutgoingEmail = {
    id: msg.id,
    from: { name: s.fromName, email: s.fromAddress },
    to: msg.to,
    replyTo: msg.replyTo || s.replyTo,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    template: msg.template ?? 'message',
    related,
  }
  try {
    const { id: providerId } = await PROVIDERS[s.provider](outgoing, { apiKey: config.ownerSecret('EMAIL_API_KEY'), config: s.config })
    await db.emailMessage.update({
      where: { id },
      data: { status: 'sent', provider: s.provider, providerId: cut(providerId, 255), sentAt: new Date(), error: null, claimedAt: null },
    })
    await countSent(db, msg.template)
    return { status: 'sent', error: null }
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 2000)
    const retryable = e instanceof EmailProviderError ? e.retryable : true
    const configProblem = e instanceof EmailProviderError && e.config
    console.error(`[email] message ${id} (${msg.template ?? 'copy'}) → ${maskEmail(msg.to)} via ${s.provider} failed: ${error}`)
    if (retryable && job && job.attempt < job.maxAttempts) {
      await db.emailMessage.update({ where: { id }, data: { provider: s.provider, error, claimedAt: null } }).catch(() => undefined)
      return { status: 'queued', error, retry: true }
    }
    await db.emailMessage.update({ where: { id }, data: { status: 'failed', provider: s.provider, error, claimedAt: null } }).catch(() => undefined)
    await countFailed(db, msg.template)
    return { status: 'failed', error, config: configProblem }
  }
}

/** Send a stored message again through the current provider, as a NEW EmailMessage row (delivered inline). */
export async function resendMessage(db: Db, messageId: number): Promise<QueueResult | null> {
  const old = await db.emailMessage.findUnique({
    where: { id: messageId },
    select: { template: true, to: true, subject: true, html: true, text: true, relatedType: true, relatedId: true, replyTo: true },
  })
  if (!old) return null
  const s = await loadEmailSettings(db)
  const base = { ...old, provider: s.provider }
  if (s.provider === 'outbox') {
    const row = await db.emailMessage.create({ data: { ...base, status: 'stored' }, select: { id: true } })
    await countSent(db, old.template)
    return { id: row.id, status: 'stored', error: null }
  }
  if (!validRecipient(old.to)) {
    const row = await db.emailMessage.create({ data: { ...base, status: 'failed', error: 'No valid recipient address' }, select: { id: true } })
    await countFailed(db, old.template)
    return { id: row.id, status: 'failed', error: 'No valid recipient address' }
  }
  const row = await db.emailMessage.create({ data: { ...base, status: 'queued' }, select: { id: true } })
  const r = await deliverMessage(db, row.id)
  return { id: row.id, status: r.status, error: r.error }
}

// ─── Sweep (the send-email schedule) ─────────────────────────────────────────

export const SWEEP_BATCH = 10
export const SWEEP_MIN_AGE_MS = 2 * 60_000
export const SWEEP_MAX_AGE_MS = 7 * 24 * 3600_000

/**
 * Deliver messages left `queued` (a refused job, a run that died): up to 10 rows older than two minutes,
 * five at a time, each through the same claim. Rows queued for 7 days or more fail ("Not sent within 7 days").
 */
export async function sweepQueued(db: Db, now = new Date()): Promise<{ expired: number; delivered: number; failed: number }> {
  const oldest = new Date(now.getTime() - SWEEP_MAX_AGE_MS)
  const expired = await db.emailMessage.updateMany({
    where: { status: 'queued', createdAt: { lte: oldest } },
    data: { status: 'failed', error: 'Not sent within 7 days', claimedAt: null },
  })
  const rows = await db.emailMessage.findMany({
    where: { status: 'queued', createdAt: { lt: new Date(now.getTime() - SWEEP_MIN_AGE_MS), gt: oldest } },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true },
  })
  let delivered = 0
  let failed = 0
  for (let i = 0; i < rows.length; i += 5) {
    const results = await Promise.allSettled(rows.slice(i, i + 5).map((r) => deliverMessage(db, r.id)))
    for (const r of results) {
      if (r.status === 'fulfilled' && (r.value.status === 'sent' || r.value.status === 'stored')) delivered++
      else if (r.status === 'rejected' || r.value.status === 'failed') failed++
    }
  }
  return { expired: expired.count, delivered, failed }
}

// ─── The contract (src/server/lib/contracts.ts `sendTemplate`) ───────────────

export interface SendTemplateOpts {
  requestUrl?: string
  related?: Related
  replyTo?: string
  locale?: string
}

/** Send a templated email. Never throws: failures are rows (`failed` + error) or a masked log line. */
export async function sendTemplateImpl(db: Db, key: string, to: string, vars: EmailVars, opts: SendTemplateOpts = {}): Promise<void> {
  try {
    const d = templateDefault(key)
    if (!d || d.retired) {
      console.warn(`[email] ${key} → ${maskEmail(to)} not sent: ${d ? 'this template is no longer sent by the store' : 'unknown template'}`)
      return
    }
    await queueTemplate(db, key, to, vars, { related: opts.related, replyTo: opts.replyTo, locale: opts.locale, requestUrl: opts.requestUrl })
  } catch (e) {
    console.error(`[email] ${key} → ${maskEmail(to)} failed before sending: ${e instanceof Error ? e.message : String(e)}`)
  }
}
