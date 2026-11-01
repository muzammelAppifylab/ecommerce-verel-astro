/* Product variants (port of VAREL tests/product-variants.test.ts, the parts F4 owns): the server's option helpers,
   the storefront's variant pickers (src/lib/product.ts) and the bag's variant choice (pickVariant).
   The admin editor half (variants built from options, the product form) moves with the products admin (WP-17/18). */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { optionDefs, optionValues, variantMeta } from '../src/server/lib/variant-options'
import { customOptionsOf } from '../src/server/lib/serializers'
import { pickVariant } from '../src/server/lib/cart'
import { addLabel, firstAvailableVariant, lineStock, soldOutSizes, variantOf } from '../src/lib/product'

describe('server option helpers', () => {
  it('reads option JSON defensively and labels lines', () => {
    assert.deepEqual(optionValues({ Fabric: 'Canvas', bad: 3 }), { Fabric: 'Canvas' })
    assert.deepEqual(optionValues(null), {})
    assert.deepEqual(optionDefs([{ kind: 'custom', name: 'Fabric', values: ['Canvas'] }, { kind: 'nope' }]), [{ kind: 'custom', name: 'Fabric', values: ['Canvas'] }])
    assert.equal(variantMeta({ color: 'Black', size: 'M', options: { Fabric: 'Canvas' } }), 'Black · M · Canvas')
  })

  it('lists custom options in the admin order, then any found only on variants', () => {
    const p = {
      options: [{ kind: 'custom', name: 'Fabric', values: ['Linen', 'Canvas'] }],
      variants: [{ options: { Fabric: 'Canvas', Length: 'Long' } }, { options: { Fabric: 'Linen' } }, { options: { Fabric: 'Wool' } }],
    } as unknown as Parameters<typeof customOptionsOf>[0]
    assert.deepEqual(customOptionsOf(p), [
      { name: 'Fabric', values: ['Linen', 'Canvas', 'Wool'] },
      { name: 'Length', values: ['Long'] },
    ])
  })
})

const v = (id: string, color: string | null, size: string | null, inventory: number | null, options: Record<string, string> = {}) => ({
  id,
  color,
  size,
  inventory,
  options,
})

describe('variant pickers', () => {
  const product = {
    sizes: ['S', 'M'],
    allowBackorder: false,
    variants: [v('a', 'Black', 'S', 0), v('b', 'Black', 'M', 3), v('c', 'Stone', 'S', 5, { Fabric: 'Canvas' }), v('d', 'Stone', 'M', 0)],
  }

  it('resolves colour, size and custom options', () => {
    assert.equal(variantOf(product, 'Black', 'M')?.id, 'b')
    assert.equal(variantOf(product, 'Stone', 'S', { Fabric: 'Canvas' })?.id, 'c')
    assert.equal(variantOf(product, 'Stone', 'S', { Fabric: 'Linen' }), undefined)
  })

  it('finds the first available variant, preferring a colour', () => {
    assert.equal(firstAvailableVariant(product)?.id, 'b')
    assert.equal(firstAvailableVariant(product, 'Stone')?.id, 'c')
    assert.equal(firstAvailableVariant({ ...product, allowBackorder: true })?.id, 'a')
  })

  it('lists sizes sold out in a colour (none for backorder products)', () => {
    assert.deepEqual(soldOutSizes(product, 'Black'), ['S'])
    assert.deepEqual(soldOutSizes(product, 'Stone'), ['M'])
    assert.deepEqual(soldOutSizes(product), [])
    assert.deepEqual(soldOutSizes({ ...product, allowBackorder: true }, 'Black'), [])
  })

  it('the bag picks by id first, then colour + size preferring stock', () => {
    assert.equal(pickVariant(product.variants, null, null, 'd')?.id, 'd')
    assert.equal(pickVariant(product.variants, 'Black', null)?.id, 'b')
    assert.equal(pickVariant(product.variants, 'Stone', 'M')?.id, 'd')
    assert.equal(pickVariant(product.variants, 'Navy', 'M'), undefined)
  })

  it('labels tiles and bag lines in English by default, or with a translator', () => {
    assert.equal(addLabel({ stock: 'out', type: 'physical' }), 'Sold out')
    assert.equal(addLabel({ stock: 'in', type: 'digital' }), 'Download')
    assert.equal(addLabel({ stock: 'in', type: 'physical' }, true), 'Added to bag')
    assert.deepEqual(lineStock({ digital: false, inventory: 2 }), { label: 'Only 2 left', className: 'text-signal-notice' })
    assert.deepEqual(lineStock({ digital: true, inventory: null }), { label: 'Digital · no shipping', className: 'text-signal-positive' })
    assert.equal(lineStock({ digital: false, inventory: 0, backorder: true }).label, 'Made to order · ships in 2–3 weeks')
    const t = (key: string) => `da:${key}`
    assert.equal(addLabel({ stock: 'in', type: 'physical' }, false, t), 'da:tile.addToBag')
  })
})
