/* DeepL API v2 (port of VAREL providers/deepl.ts). The key is the owner secret DEEPL_API_KEY (`config.ownerSecret`).
   Free keys end in ":fx" and use api-free.deepl.com. Up to 50 strings per request; markers `<x0/>` are kept with
   tag_handling=xml, so every string is XML-escaped on the way in and out. Only the strings and the language codes
   leave the site. */
import { config } from '../../../../platform/config'
import { errorSnippet, providerFetch, TranslateError, withRetry, type TranslationProvider } from './types'

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;x(\d+)\/&gt;/g, '<x$1/>')
export const unesc = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** DeepL language codes: source is the bare code, some targets need a variant. */
const TARGET: Record<string, string> = { en: 'EN-GB', pt: 'PT-PT', nb: 'NB', no: 'NB', zh: 'ZH' }
export const deeplTarget = (l: string) => TARGET[l] ?? l.toUpperCase()

/** Fixed origins only: free keys end in ":fx". */
export const deeplHost = (key: string) => (key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com')

export const deeplReady = () => !!config.ownerSecret('DEEPL_API_KEY')

export function deeplProvider(): TranslationProvider | null {
  const key = config.ownerSecret('DEEPL_API_KEY')
  if (!key) return null
  const host = deeplHost(key)
  return {
    name: 'deepl',
    batchSize: 50,
    translate: (texts, from, to) =>
      withRetry(async () => {
        const res = await providerFetch('DeepL', `${host}/v2/translate`, {
          method: 'POST',
          headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: texts.map(esc),
            source_lang: from.toUpperCase(),
            target_lang: deeplTarget(to),
            tag_handling: 'xml',
            preserve_formatting: true,
          }),
        })
        if (!res.ok) {
          // 456 = quota exceeded: an immediate retry cannot help.
          throw new TranslateError(`DeepL ${res.status}: ${await errorSnippet(res)}`, res.status === 456 ? 400 : res.status)
        }
        const data = (await res.json().catch(() => null)) as { translations?: { text?: unknown }[] } | null
        const list = Array.isArray(data?.translations) ? data.translations : []
        if (list.length !== texts.length || !list.every((t) => typeof t?.text === 'string')) {
          throw new TranslateError('DeepL returned a different number of translations', 502)
        }
        return list.map((t) => unesc(t.text as string))
      }),
  }
}
