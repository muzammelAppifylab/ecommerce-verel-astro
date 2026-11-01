/* Webhook: the ezystudio body POSTed to any https URL (Zapier, Make, n8n, a custom relay). Port of VAREL
   worker/lib/email/webhook.ts. Any 2xx counts as sent; { id } in the response is stored when present. The
   bearer header is sent only when EMAIL_API_KEY is added; Idempotency-Key: email-<id> always. */
import { idempotencyHeader, postJson, requireEndpoint, type ProviderSend } from './provider'
import { genericBody } from './ezystudio'

export const sendWebhook: ProviderSend = async (msg, opts) => {
  const url = requireEndpoint(opts, 'the webhook')
  const res = await postJson(url, { ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}), ...idempotencyHeader(msg) }, genericBody(msg))
  return { id: typeof res.id === 'string' || typeof res.id === 'number' ? String(res.id).slice(0, 255) : null }
}
