/* Shipping zones and methods (port of VAREL worker/lib/shipping.ts). Rates are cents in the database,
   currency units in the API. */
import type { Prisma } from '../../generated/prisma/client'
import type { Db } from './db'
import { fromCents } from './money'
import type { ShippingMethod, ShippingZone } from './contract-types'

const zoneInclude = { methods: { orderBy: { position: 'asc' } } } satisfies Prisma.ShippingZoneInclude
export type ZoneRow = Prisma.ShippingZoneGetPayload<{ include: typeof zoneInclude }>

export const serializeMethod = (m: ZoneRow['methods'][number]): ShippingMethod => ({
  id: m.id,
  name: m.name,
  detail: m.detail,
  rate: fromCents(m.rateCents),
})

export const serializeZone = (z: ZoneRow): ShippingZone => ({ zone: z.name, methods: z.methods.map(serializeMethod) })

/** Every zone with its methods (a handful of rows: the store's shipping table, capped). */
export async function allZones(db: Db): Promise<ZoneRow[]> {
  return db.shippingZone.findMany({ include: zoneInclude, orderBy: { position: 'asc' }, take: 100 })
}

/** Denmark → Denmark; EU countries → European Union; anything else → Rest of world. */
export async function zoneForCountry(db: Db, country: string | null | undefined): Promise<ZoneRow> {
  const zones = await allZones(db)
  const c = (country ?? 'Denmark').trim().toLowerCase()
  const match =
    zones.find((z) => z.countries.some((x) => x.toLowerCase() === c) || z.name.toLowerCase() === c) ??
    zones.find((z) => z.countries.length === 0) ??
    zones[zones.length - 1]
  if (!match) throw new Error('No shipping zones configured — run the seed')
  return match
}
