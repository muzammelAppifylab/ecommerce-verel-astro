/* Provider selection from Setting.translationProvider and the owner's secrets (port of VAREL providers/index.ts).
   Returns null when the provider is "none" or is missing its secrets (translations then stay missing until it is
   set up). Secrets come only from `config.ownerSecret` (AGENTS.md); `mock` never runs on the live site. */
import { config } from '../../../../platform/config'
import { deeplProvider, deeplReady } from './deepl'
import { mockProvider } from './mock'
import type { ProviderName, TranslationProvider } from './types'
import { workersAiProvider, workersAiReady } from './workers-ai'

export type { ProviderName, TranslationProvider } from './types'
export { TranslateError } from './types'
export { workersAiReady } from './workers-ai'

export const PROVIDER_NAMES: readonly ProviderName[] = ['workers-ai', 'deepl', 'none', 'mock']

export const providerNameOf = (v: string | null | undefined): ProviderName =>
  (PROVIDER_NAMES as readonly string[]).includes(v ?? '') ? (v as ProviderName) : 'workers-ai'

export function getProvider(name: ProviderName): TranslationProvider | null {
  switch (name) {
    case 'workers-ai':
      return workersAiProvider()
    case 'deepl':
      return deeplProvider()
    case 'mock':
      return config.production ? null : mockProvider()
    default:
      return null
  }
}

/** Whether the provider has what it needs (its secrets). */
export function providerReady(name: ProviderName): boolean {
  if (name === 'workers-ai') return workersAiReady()
  if (name === 'deepl') return deeplReady()
  return name === 'mock' && !config.production
}
