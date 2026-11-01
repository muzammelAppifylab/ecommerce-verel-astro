/* Shipping zones and methods (port of VAREL worker/lib/shipping.ts). Rates are cents in the database,
   currency units in the API. */
import type { Prisma } from '../../generated/prisma/client'
import type { Db } from './db'
import { HttpError } from './errors'
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
  // No zone at all (the owner deleted them, or no seed): a known answer, not a 500 (I2).
  if (!match) throw new HttpError(503, 'SHIPPING_NOT_CONFIGURED', 'Shipping is not set up yet. Try again in a moment.')
  return match
}
