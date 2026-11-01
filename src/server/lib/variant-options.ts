/* Variant options (Shopify-style, up to 3 per product). Colour and size keep their own columns (swatches, size
   guide, catalog filters); any other option ("Fabric", "Length") is a custom one whose value per variant lives in
   Variant.options. Product.options holds the option list and order. */
import type { Prisma } from '../../generated/prisma/client'

export type OptionKind = 'color' | 'size' | 'custom'
export interface OptionDef {
  kind: OptionKind
  name: string
  values: string[]
}
export type OptionValues = Record<string, string>

export const MAX_OPTIONS = 3

/** Custom option values from a JSON column; anything malformed reads as none. */
export function optionValues(json: Prisma.JsonValue | null | undefined): OptionValues {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const out: OptionValues = {}
  for (const [k, v] of Object.entries(json)) if (typeof v === 'string' && v) out[k] = v
  return out
}

/** The product's option list from its JSON column; [] when unset (older products: derived from the variants). */
export function optionDefs(json: Prisma.JsonValue | null | undefined): OptionDef[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return []
    const { kind, name, values } = o as Record<string, unknown>
    if ((kind !== 'color' && kind !== 'size' && kind !== 'custom') || typeof name !== 'string' || !Array.isArray(values)) return []
    return [{ kind, name, values: values.filter((v): v is string => typeof v === 'string') }]
  })
}

/** "Camel · M · Canvas": every option value of a variant or order line, in a stable order. */
export function variantMeta(v: { color?: string | null; size?: string | null; options?: Prisma.JsonValue | OptionValues | null }): string {
  return [v.color, v.size, ...Object.values(optionValues(v.options as Prisma.JsonValue))].filter(Boolean).join(' · ')
}
