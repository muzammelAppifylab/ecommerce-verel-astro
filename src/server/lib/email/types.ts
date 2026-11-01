/* Wire shapes added by WP-22 next to F3's src/lib/types/admin/emails.ts (Request R5: move them there).
   Type-only: the portal imports them with `import type`. */
import type { AdminEmailMessage, AdminEmailMessageDetail, EmailStatus } from '../../../lib/types/admin/emails'

export type { AdminEmailMessage, AdminEmailMessageDetail, EmailStatus }

/** GET /site-api/manage/emails/messages/counts: each status 0–100; `capped` lists the statuses with more than 100. */
export interface EmailMessageCounts {
  stored: number
  queued: number
  sent: number
  failed: number
  skipped: number
  capped: EmailStatus[]
}

/** The message viewer's extras: delivery tries and the per-message reply-to. */
export interface AdminEmailMessageFull extends AdminEmailMessageDetail {
  attempts: number
  replyTo: string | null
}

export type EmailProviderId = 'outbox' | 'resend' | 'postmark' | 'ezystudio' | 'webhook'

/** GET/PATCH /site-api/manage/emails/delivery: provider and sender settings (never the API key itself). */
export interface EmailDelivery {
  emailProvider: EmailProviderId
  emailConfig: { endpoint?: string; messageStream?: string }
  emailFromName: string
  emailFromAddress: string
  emailReplyTo: string | null
  staffAlertEmail: string | null
  supportEmail: string
  lowStockThreshold: number
  /** Whether the owner secret EMAIL_API_KEY is added. */
  secrets: { emailApiKey: boolean }
}

export type EmailDeliveryInput = Partial<Omit<EmailDelivery, 'supportEmail' | 'lowStockThreshold' | 'secrets'>>
