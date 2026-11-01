/* EzyStudio email service: a generic JSON HTTP API (port of VAREL worker/lib/email/ezystudio.ts; contract in
   docs/migration/handoff/WP-22.md). POST {endpoint}, Authorization: Bearer EMAIL_API_KEY, Idempotency-Key:
   email-<id>, body below; expects 2xx { id }. */
import { EmailProviderError, idempotencyHeader, postJson, requireEndpoint, requireKey, type OutgoingEmail, type ProviderSend } from './provider'

/** The shared request body for the ezystudio and webhook providers. */
export function genericBody(msg: OutgoingEmail) {
  return {
    from: { name: msg.from.name, email: msg.from.email },
    to: [{ email: msg.to }],
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    tags: msg.template ? [msg.template] : [],
    metadata: { relatedType: msg.related?.type ?? null, relatedId: msg.related?.id ?? null },
  }
}

export const sendEzyStudio: ProviderSend = async (msg, opts) => {
  const url = requireEndpoint(opts, 'the EzyStudio email service')
  const key = requireKey(opts, 'the EzyStudio email service')
  const res = await postJson(url, { Authorization: `Bearer ${key}`, ...idempotencyHeader(msg) }, genericBody(msg))
  if (typeof res.id !== 'string' && typeof res.id !== 'number') throw new EmailProviderError('The EzyStudio email service did not return a message id')
  return { id: String(res.id).slice(0, 255) }
}
