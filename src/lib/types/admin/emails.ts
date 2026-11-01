/* Admin email templates and the message log (docs/EMAIL.md, VAREL src/lib/admin/emails.ts).
   Routes: /site-api/manage/emails (WP-22). */
import type { ListParams } from './common'

export type EmailVarValue = string | number | boolean | null | Record<string, string | number | null>[]
export type EmailVars = Record<string, EmailVarValue>

export interface AdminEmailTemplate {
  key: string
  name: string
  description: string
  audience: 'customer' | 'staff'
  subject: string
  body: string
  enabled: boolean
  /** Subject or body differs from the default */
  customised: boolean
  updatedAt: string | null
  variables: { name: string; description: string }[]
  sample: EmailVars
  defaults: { subject: string; body: string }
  stats: { sent: number; failed: number; lastAt: string | null }
}

/** PATCH /site-api/manage/emails/templates/:key */
export interface EmailTemplateInput {
  subject?: string
  body?: string
  enabled?: boolean
}

export type EmailStatus = 'stored' | 'queued' | 'sent' | 'failed' | 'skipped'

export interface AdminEmailMessage {
  id: string
  template: string | null
  to: string
  subject: string
  provider: string
  status: EmailStatus
  error: string | null
  providerId: string | null
  relatedType: string | null
  relatedId: string | null
  createdAt: string
  sentAt: string | null
}

export interface AdminEmailMessageDetail extends AdminEmailMessage {
  html: string
  text: string
}

export interface EmailPreview {
  subject: string
  html: string
  text: string
  /** Variables used in the template that are not documented for it */
  unknown: string[]
  /** Unbalanced section tags, if any */
  problem: string | null
}

export interface MessageListParams extends ListParams {
  status?: EmailStatus
  template?: string
}
