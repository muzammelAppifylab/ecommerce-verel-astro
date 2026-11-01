/* Cloudflare Workers AI, model @cf/meta/m2m100-1.2b (port of VAREL providers/workers-ai.ts), through the REST API
   only: this site is one Worker without bindings, so the `AI` binding VAREL could use does not exist here. Owner
   secrets CF_ACCOUNT_ID (32 hex characters) and CF_AI_TOKEN (an API token with Workers AI read access).
   One request per string (the model has no synchronous batch input), a few in flight at a time. */
import { config } from '../../../../platform/config'
import { errorSnippet, mapLimit, providerFetch, TranslateError, withRetry, type TranslationProvider } from './types'

export const M2M100_MODEL = '@cf/meta/m2m100-1.2b'
const CONCURRENCY = 4
const ACCOUNT_ID = /^[a-f0-9]{32}$/

function credentials(): { account: string; token: string } | null {
  const account = config.ownerSecret('CF_ACCOUNT_ID')?.trim().toLowerCase()
  const token = config.ownerSecret('CF_AI_TOKEN')
  return account && token && ACCOUNT_ID.test(account) ? { account, token } : null
}

export const workersAiReady = (): boolean => credentials() !== null

export const workersAiUrl = (account: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${M2M100_MODEL}`

export function textOf(out: unknown): string {
  const o = out as { translated_text?: unknown; result?: { translated_text?: unknown } } | null
  const t = o?.translated_text ?? o?.result?.translated_text
  if (typeof t !== 'string') throw new TranslateError('Workers AI returned no translation', 502)
  return t
}

export function workersAiProvider(): TranslationProvider | null {
  const creds = credentials()
  if (!creds) return null
  const url = workersAiUrl(creds.account)
  const one = async (text: string, from: string, to: string): Promise<string> => {
    const res = await providerFetch('Workers AI', url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source_lang: from, target_lang: to }),
    })
    if (!res.ok) throw new TranslateError(`Workers AI ${res.status}: ${await errorSnippet(res)}`, res.status)
    return textOf(await res.json().catch(() => null))
  }
  return {
    name: 'workers-ai',
    batchSize: 16,
    translate: (texts, from, to) => mapLimit(texts, CONCURRENCY, (t) => withRetry(() => one(t, from, to))),
  }
}
