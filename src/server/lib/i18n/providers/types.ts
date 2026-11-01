/* Machine-translation provider contract (port of VAREL worker/lib/i18n/providers/types.ts, docs/I18N.md "Provider").
   A provider translates a batch of plain strings from one language to another and returns them in the same order.
   Strings may contain inline markers `<x0/>` (protected placeholders); providers must pass them through untouched or
   the engine falls back to translating the text around them. Providers throw TranslateError on failure; the engine
   decides what to keep.
   Difference from VAREL: no sleeping backoff (the template never waits inside a request or a job). A failed call is
   retried at most once, immediately, on a network error or a 5xx; a 429 is not retried: it is counted as failed and
   the backfill job tries again on its next run. */

export type ProviderName = 'workers-ai' | 'deepl' | 'none' | 'mock'

export interface TranslationProvider {
  name: ProviderName
  /** Most strings per translate() call. */
  batchSize: number
  translate(texts: string[], from: string, to: string): Promise<string[]>
}

export class TranslateError extends Error {
  constructor(
    message: string,
    /** HTTP status from the provider, when there was one (429 = rate limited). */
    readonly status?: number,
  ) {
    super(message)
    this.name = 'TranslateError'
  }
}

/** Retry at once (never sleeping) on a network error (no status) or a server error (5xx); `attempts` in all. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const status = e instanceof TranslateError ? e.status : undefined
      if (status !== undefined && status < 500) break
    }
  }
  throw last
}

/** Run `fn` over `items` with at most `limit` in flight; results keep their order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/** Provider calls never hang a request or a job. */
export const PROVIDER_TIMEOUT_MS = 10_000

/** A provider's error body, shortened, for the server log only (never for a response). */
export async function errorSnippet(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  return body.replace(/\s+/g, ' ').slice(0, 200)
}

/** fetch with the provider timeout; network failures and timeouts become a TranslateError without a status. */
export async function providerFetch(name: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new TranslateError(`${name}: ${timeout ? 'no answer within 10 s' : 'could not be reached'}`)
  }
}
