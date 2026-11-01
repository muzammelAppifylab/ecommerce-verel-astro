/* Postmark: https://postmarkapp.com/developer/api/email-api (port of VAREL worker/lib/email/postmark.ts). Postmark has no idempotency header. */
import { EmailProviderError, formatAddress, postJson, requireKey, type ProviderSend } from './provider'

export const sendPostmark: ProviderSend = async (msg, opts) => {
  const key = requireKey(opts, 'Postmark')
  const res = await postJson(
    'https://api.postmarkapp.com/email',
    { 'X-Postmark-Server-Token': key },
    {
      From: formatAddress(msg.from),
      To: msg.to,
      Subject: msg.subject,
      HtmlBody: msg.html,
      TextBody: msg.text,
      MessageStream: opts.config.messageStream?.trim() || 'outbound',
      ...(msg.replyTo ? { ReplyTo: msg.replyTo } : {}),
      ...(msg.template ? { Tag: msg.template } : {}),
      ...(msg.related ? { Metadata: { relatedType: msg.related.type, relatedId: msg.related.id } } : {}),
    },
  )
  // Postmark answers 200 with ErrorCode 0 on success.
  if (typeof res.ErrorCode === 'number' && res.ErrorCode !== 0) throw new EmailProviderError(`${res.ErrorCode} ${String(res.Message ?? '')}`)
  return { id: typeof res.MessageID === 'string' ? res.MessageID : null }
}
