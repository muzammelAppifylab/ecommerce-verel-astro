/* Email delivery settings (VAREL admin Settings · Email, WP-22): the shared input rules for the six `settings` columns
   the Delivery tab writes, and their serializer. WP-23's settings PATCH may reuse `emailDeliveryPatch` (Request R4). */
import { z } from 'zod'

import { config } from '../../../platform/config'
import type { Db } from '../db'
import { getSettings } from '../settings'
import { emailField } from '../validate'
import { EMAIL_PROVIDERS, endpointProblem, isEmailProvider } from './provider'
import { providerConfigOf } from './send'
import type { EmailDelivery } from './types'

export const ENDPOINT_MESSAGE = 'Use a full link starting with https://'

/** Providers that POST to an owner-set endpoint. */
export const ENDPOINT_PROVIDERS = ['ezystudio', 'webhook'] as const
export const needsEndpoint = (p: string) => (ENDPOINT_PROVIDERS as readonly string[]).includes(p)

const optionalEmail = z.union([z.literal(''), z.null(), emailField]).transform((v) => (v ? v : null))

const emailConfigField = z
  .object(
    {
      endpoint: z.string({ error: ENDPOINT_MESSAGE }).trim().max(500, 'Keep the link under 500 characters').optional(),
      messageStream: z
        .string({ error: 'Use letters, digits and dashes' })
        .trim()
        .max(100, 'Keep the stream name under 100 characters')
        .refine((v) => v === '' || /^[a-z0-9-]+$/i.test(v), 'Use letters, digits and dashes')
        .optional(),
    },
    { error: 'Use the provider settings' },
  )
  .strict()
  .superRefine((v, ctx) => {
    if (v.endpoint && endpointProblem(v.endpoint)) ctx.addIssue({ code: 'custom', path: ['endpoint'], message: ENDPOINT_MESSAGE })
  })
  .transform((v) => {
    const out: { endpoint?: string; messageStream?: string } = {}
    if (v.endpoint) out.endpoint = v.endpoint
    if (v.messageStream) out.messageStream = v.messageStream
    return out
  })

/** PATCH input: any subset of the six columns. Empty optional addresses become null. */
export const emailDeliveryPatch = z.object({
  emailProvider: z.enum(EMAIL_PROVIDERS, { error: 'Choose an email provider' }).optional(),
  emailConfig: emailConfigField.optional(),
  emailFromName: z
    .string({ error: 'Enter a sender name' })
    .trim()
    .min(1, 'Enter a sender name')
    .max(80, 'Keep a sender name under 80 characters')
    .optional(),
  emailFromAddress: emailField.optional(),
  emailReplyTo: optionalEmail.optional(),
  staffAlertEmail: optionalEmail.optional(),
})
export type EmailDeliveryPatch = z.output<typeof emailDeliveryPatch>

/** The endpoint rule that depends on the resulting provider: required for ezystudio and webhook. */
export function deliveryProblems(provider: string, emailConfig: { endpoint?: string }): Record<string, string> | null {
  if (needsEndpoint(provider) && endpointProblem(emailConfig.endpoint)) return { 'emailConfig.endpoint': ENDPOINT_MESSAGE }
  return null
}

export const DELIVERY_SELECT = {
  emailProvider: true,
  emailConfig: true,
  emailFromName: true,
  emailFromAddress: true,
  emailReplyTo: true,
  staffAlertEmail: true,
  supportEmail: true,
  lowStockThreshold: true,
} as const

type DeliveryRow = {
  emailProvider: string
  emailConfig: unknown
  emailFromName: string
  emailFromAddress: string
  emailReplyTo: string | null
  staffAlertEmail: string | null
  supportEmail: string
  lowStockThreshold: number
}

export const emailApiKeySet = () => !!config.ownerSecret('EMAIL_API_KEY')

export function deliveryOut(s: DeliveryRow): EmailDelivery {
  const cfg = providerConfigOf(s.emailConfig)
  return {
    emailProvider: isEmailProvider(s.emailProvider) ? s.emailProvider : 'outbox',
    emailConfig: { ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}), ...(cfg.messageStream ? { messageStream: cfg.messageStream } : {}) },
    emailFromName: s.emailFromName,
    emailFromAddress: s.emailFromAddress,
    emailReplyTo: s.emailReplyTo || null,
    staffAlertEmail: s.staffAlertEmail || null,
    supportEmail: s.supportEmail,
    lowStockThreshold: s.lowStockThreshold,
    secrets: { emailApiKey: emailApiKeySet() },
  }
}

/** The settings row's delivery columns (the row is created with defaults when missing, F4 `getSettings`). */
export async function loadDelivery(db: Db): Promise<DeliveryRow> {
  const row = await db.setting.findUnique({ where: { id: 1 }, select: DELIVERY_SELECT })
  if (row) return row
  await getSettings(db)
  return db.setting.findUniqueOrThrow({ where: { id: 1 }, select: DELIVERY_SELECT })
}
