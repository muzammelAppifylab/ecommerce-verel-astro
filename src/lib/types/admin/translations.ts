/* Admin content translations (docs/I18N.md, VAREL src/lib/admin/translations.ts).
   Routes: /site-api/manage/translations (WP-25). */
import type { ListParams } from './common'
import type { StoreSettings, TranslationProvider } from './store'

export type { TranslationProvider }

export type TranslationEntity =
  | 'product'
  | 'option'
  | 'department'
  | 'category'
  | 'post'
  | 'post_category'
  | 'page'
  | 'collection'
  | 'menu'
  | 'shipping_method'
  | 'discount'
  | 'email_template'
  | 'setting'
  | 'ui'

export type TranslationStatus = 'missing' | 'stale' | 'auto' | 'manual'

export interface LocaleCoverage {
  total: number
  translated: number
  missing: number
  stale: number
  auto: number
  manual: number
}

export interface EntityCoverage {
  entity: string
  /** Translatable fields of this entity type (records × fields) */
  total: number
  locales: Record<string, LocaleCoverage>
}

export interface TranslationsStatus {
  defaultLocale: string
  locales: string[]
  provider: TranslationProvider
  autoTranslate: boolean
  /** Whether the selected provider has what it needs (secrets) */
  providerReady?: boolean
  entities: EntityCoverage[]
  totals: Record<string, LocaleCoverage>
}

export interface TranslationRow {
  entity: string
  entityId: string
  /** Human name of the record, e.g. the product name */
  label: string
  field: string
  locale: string
  sourceValue: string
  value: string | null
  status: TranslationStatus
  /** Who wrote the existing translation; null when missing */
  origin: 'auto' | 'manual' | null
  updatedAt: string | null
}

/** GET /site-api/manage/translations: a keyset page */
export interface TranslationList {
  items: TranslationRow[]
  nextCursor: string | null
}

export interface FieldTranslation {
  value: string
  source: 'auto' | 'manual'
  stale: boolean
  updatedAt: string | null
}

export interface EntityField {
  field: string
  /** Source value in the default locale; JSON-encoded for structured fields */
  sourceValue: string
  json: boolean
  translations: Record<string, FieldTranslation | null>
}

export interface EntityTranslations {
  entity: string
  entityId: string
  label: string
  defaultLocale: string
  locales: string[]
  fields: EntityField[]
}

/** PUT /site-api/manage/translations/:entity/:id */
export interface EntityTranslationsInput {
  locale: string
  fields: Record<string, string | null>
}

export interface TranslateMissingResult {
  translated: number
  failed?: number
  remaining: number
}

export interface I18nSettings {
  defaultLocale: string
  locales: string[]
  translationProvider: TranslationProvider
  autoTranslate: boolean
  secrets: StoreSettings['secrets']
}

export type SettingsWithI18n = StoreSettings & Partial<I18nSettings>

export interface TranslationListParams extends ListParams {
  entity?: string
  locale?: string
  status?: TranslationStatus | ''
}

export interface TranslationTarget {
  entity: string
  entityId: string
  field?: string
  locale?: string
}

export interface BackfillProgress {
  running: boolean
  /** Translations written in this run */
  done: number
  /** done + what is left; null until the first batch answers */
  total: number | null
  failed: number
  error: string | null
  finished: boolean
}
