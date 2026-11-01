/* Admin helpers for Settings · Emails (port of the shapes and helpers in VAREL worker/routes/admin/emails.ts, WP-22).
   Pure functions: serializers, the section-balance check and the sample-data cleaner. */
import type { AdminEmailTemplate } from '../../../lib/types/admin/emails'
import { COMMON_VARIABLES, type TemplateDefault } from './defaults'
import type { EmailVars } from './send'
import { variablesIn } from './template'
import type { AdminEmailMessage, AdminEmailMessageFull, EmailStatus } from './types'

export type TemplateRow = {
  subject: string
  body: string
  enabled: boolean
  updatedAt: Date
  sentCount: number
  failedCount: number
  lastSentAt: Date | null
} | null

export const TEMPLATE_SELECT = {
  key: true,
  subject: true,
  body: true,
  enabled: true,
  updatedAt: true,
  sentCount: true,
  failedCount: true,
  lastSentAt: true,
} as const

export function templateOut(d: TemplateDefault, row: TemplateRow): AdminEmailTemplate {
  const subject = row?.subject ?? d.subject
  const body = row?.body ?? d.body
  return {
    key: d.key,
    name: d.name,
    description: d.description,
    audience: d.audience,
    subject,
    body,
    enabled: row?.enabled ?? true,
    customised: subject !== d.subject || body !== d.body,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    variables: [...d.variables, ...COMMON_VARIABLES.filter((c) => !d.variables.some((v) => v.name === c.name))],
    sample: d.sample as AdminEmailTemplate['sample'],
    defaults: { subject: d.subject, body: d.body },
    stats: { sent: row?.sentCount ?? 0, failed: row?.failedCount ?? 0, lastAt: row?.lastSentAt?.toISOString() ?? null },
  }
}

/** Unbalanced {{#section}} … {{/section}} tags are almost always a typo: say which one. */
export function sectionProblem(src: string): string | null {
  const stack: string[] = []
  for (const m of src.matchAll(/\{\{\s*([#^/])\s*([A-Za-z_][\w.]*)\s*\}\}/g)) {
    if (m[1] === '/') {
      if (stack[stack.length - 1] !== m[2]) return `{{/${m[2]}}} has no matching {{#${m[2]}}}`
      stack.pop()
    } else stack.push(m[2])
  }
  return stack.length ? `{{#${stack[stack.length - 1]}}} is not closed with {{/${stack[stack.length - 1]}}}` : null
}

export const MAX_VAR_KEYS = 100
export const MAX_VAR_ROWS = 50
export const MAX_VAR_TEXT = 2000

/** Coerce sample variables from the editor: scalars stay, arrays of objects become rows, anything else is dropped. */
export function cleanVars(v: Record<string, unknown> | undefined): EmailVars {
  const out: EmailVars = {}
  for (const [k, val] of Object.entries(v ?? {}).slice(0, MAX_VAR_KEYS)) {
    if (k.length > 60) continue
    if (typeof val === 'string') out[k] = val.slice(0, MAX_VAR_TEXT)
    else if (val == null || typeof val === 'number' || typeof val === 'boolean') out[k] = val ?? null
    else if (Array.isArray(val)) {
      out[k] = val
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
        .slice(0, MAX_VAR_ROWS)
        .map((r) =>
          Object.fromEntries(
            Object.entries(r)
              .slice(0, 20)
              .map(([rk, rv]) => [rk, typeof rv === 'number' || rv === null ? rv : String(rv ?? '').slice(0, MAX_VAR_TEXT)]),
          ),
        )
    }
  }
  return out
}

/** Names used in subject + body that are neither documented for the template nor keys of a sample row. */
export function unknownVariables(d: TemplateDefault, tpl: { subject: string; body: string }, vars: EmailVars): string[] {
  const known = new Set([...d.variables, ...COMMON_VARIABLES].map((v) => v.name))
  const rowKeys = new Set(Object.values(vars).flatMap((v) => (Array.isArray(v) ? v.flatMap((r) => Object.keys(r)) : [])))
  return variablesIn(`${tpl.subject}\n${tpl.body}`).filter((n) => !known.has(n) && !rowKeys.has(n))
}

export const MESSAGE_SELECT = {
  id: true,
  template: true,
  to: true,
  subject: true,
  provider: true,
  status: true,
  error: true,
  providerId: true,
  relatedType: true,
  relatedId: true,
  createdAt: true,
  sentAt: true,
} as const

export const MESSAGE_FULL_SELECT = { ...MESSAGE_SELECT, html: true, text: true, attempts: true, replyTo: true } as const

type MessageRow = {
  id: number
  template: string | null
  to: string
  subject: string
  provider: string
  status: string
  error: string | null
  providerId: string | null
  relatedType: string | null
  relatedId: string | null
  createdAt: Date
  sentAt: Date | null
}

export function messageOut(m: MessageRow): AdminEmailMessage {
  return {
    id: String(m.id),
    template: m.template,
    to: m.to,
    subject: m.subject,
    provider: m.provider,
    status: m.status as EmailStatus,
    error: m.error,
    providerId: m.providerId,
    relatedType: m.relatedType,
    relatedId: m.relatedId,
    createdAt: m.createdAt.toISOString(),
    sentAt: m.sentAt?.toISOString() ?? null,
  }
}

export function messageFullOut(m: MessageRow & { html: string; text: string; attempts: number; replyTo: string | null }): AdminEmailMessageFull {
  return { ...messageOut(m), html: m.html, text: m.text, attempts: m.attempts, replyTo: m.replyTo }
}
