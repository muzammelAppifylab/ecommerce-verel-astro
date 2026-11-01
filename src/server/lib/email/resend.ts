/* Resend: https://resend.com/docs/api-reference/emails/send-email (port of VAREL worker/lib/email/resend.ts). */
import { formatAddress, idempotencyHeader, postJson, requireKey, type ProviderSend } from './provider'

export const sendResend: ProviderSend = async (msg, opts) => {
  const key = requireKey(opts, 'Resend')
  const res = await postJson(
    'https://api.resend.com/emails',
    { Authorization: `Bearer ${key}`, ...idempotencyHeader(msg) },
    {
      from: formatAddress(msg.from),
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      // Resend tags allow ASCII letters, numbers, underscores and dashes only.
      ...(msg.template ? { tags: [{ name: 'template', value: msg.template.replace(/[^\w-]/g, '_') }] } : {}),
    },
  )
  return { id: typeof res.id === 'string' ? res.id : null }
}
