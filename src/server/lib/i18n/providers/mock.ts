/* Test provider (port of VAREL providers/mock.ts): "[da] Atelier wool coat". Deterministic, offline, keeps markers.
   Never available on the live site (`providerReady('mock')` is false in production). Selected by setting
   Setting.translationProvider to "mock" in a local database (the settings API accepts only the real providers). */
import type { TranslationProvider } from './types'

export const mockTranslate = (text: string, to: string) => `[${to}] ${text}`

export const mockProvider = (): TranslationProvider => ({
  name: 'mock',
  batchSize: 100,
  translate: async (texts, _from, to) => texts.map((t) => mockTranslate(t, to)),
})
