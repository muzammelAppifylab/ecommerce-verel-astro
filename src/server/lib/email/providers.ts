/* Provider registry (port of VAREL worker/lib/email/providers.ts). */
import type { EmailProviderName, ProviderSend } from './provider'
import { sendOutbox } from './outbox'
import { sendResend } from './resend'
import { sendPostmark } from './postmark'
import { sendEzyStudio } from './ezystudio'
import { sendWebhook } from './webhook'

export const PROVIDERS: Record<EmailProviderName, ProviderSend> = {
  outbox: sendOutbox,
  resend: sendResend,
  postmark: sendPostmark,
  ezystudio: sendEzyStudio,
  webhook: sendWebhook,
}
