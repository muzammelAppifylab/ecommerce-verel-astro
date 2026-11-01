/* Server text (worker/lib/i18n/messages.ts): catalogs, interpolation, plurals, fallback and reverse lookup. */
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { formatDate, localizeFields, localizeMessage, serverT, SERVER_CATALOGS } from '../src/server/lib/i18n/messages'
import { en } from '../src/server/lib/i18n/catalogs/en'
import { evaluatePromotions } from '../src/server/lib/discounts'
import { computeTotals } from '../src/server/lib/totals'
import { discount, input, line } from './promotions-helpers'

describe('serverT', () => {
  it('returns catalog text per locale', () => {
    assert.equal(serverT('en', 'stock.low'), 'Low stock')
    assert.equal(serverT('da', 'stock.low'), 'Få tilbage')
    assert.equal(serverT('de', 'stock.out'), 'Ausverkauft')
  })

  it('interpolates {placeholders}', () => {
    assert.equal(serverT('en', 'discount.expired', { name: 'STUDIO10' }), 'STUDIO10 has expired')
    assert.equal(serverT('fr', 'discount.expired', { name: 'STUDIO10' }), 'STUDIO10 a expiré')
    assert.equal(serverT('sv', 'totals.taxIncluded', { amount: '$29.60', tax: 'VAT' }), 'Inkl. $29.60 VAT')
    // Unknown placeholders stay visible rather than disappearing.
    assert.equal(serverT('en', 'discount.expired'), '{name} has expired')
  })

  it('English: the caller’s fallback wins, so output stays byte-identical', () => {
    assert.equal(serverT('en', 'stock.in', {}, 'In stock'), 'In stock')
    assert.equal(serverT('en', 'no.such.key', { n: 2 }, 'Only {n} left'), 'Only 2 left')
  })

  it('falls back to the English fallback, then the English catalog, then the key', () => {
    assert.equal(serverT('it', 'stock.in'), 'In stock') // no shipped catalog
    assert.equal(serverT('it', 'stock.in', {}, 'Fallback'), 'Fallback')
    assert.equal(serverT('da', 'no.such.key', {}, 'Fallback {x}'), 'Fallback {x}')
    assert.equal(serverT('da', 'no.such.key'), 'no.such.key')
  })

  it('picks plural forms from vars.count', () => {
    assert.equal(serverT('en', 'returns.closeAfter', { count: 1 }), 'Returns close 1 day after delivery')
    assert.equal(serverT('en', 'returns.closeAfter', { count: 30 }), 'Returns close 30 days after delivery')
    assert.equal(serverT('da', 'returns.closeAfter', { count: 1 }), 'Returnering lukker 1 dag efter levering')
    assert.equal(serverT('da', 'returns.closeAfter', { count: 14 }), 'Returnering lukker 14 dage efter levering')
  })

  it('every shipped catalog has exactly the English keys and placeholders', () => {
    const keys = Object.keys(en).sort()
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const [locale, cat] of Object.entries(SERVER_CATALOGS)) {
      assert.deepEqual(Object.keys(cat).sort(), keys, locale)
      for (const k of keys) assert.equal(ph((cat as Record<string, string>)[k]!), ph((en as Record<string, string>)[k]!), `${locale} ${k}`)
      for (const k of keys) assert.ok(!(cat as Record<string, string>)[k]!.includes('!'), `${locale} ${k}: no exclamation marks`)
    }
  })
})

describe('localizeMessage', () => {
  it('translates exact English messages and leaves English alone', () => {
    assert.equal(localizeMessage('de', 'We cannot find that product'), 'Wir finden dieses Produkt nicht')
    assert.equal(localizeMessage('en', 'We cannot find that product'), 'We cannot find that product')
    assert.equal(localizeMessage('da', 'Something nobody wrote'), 'Something nobody wrote')
  })

  it('matches templates and translates captured catalog phrases', () => {
    assert.equal(localizeMessage('da', 'Enter your first name'), 'Indtast dit fornavn')
    assert.equal(localizeMessage('de', 'Keep your first name under 80 characters'), 'Höchstens 80 Zeichen für deinen Vornamen')
    assert.equal(localizeMessage('sv', 'Returns close 30 days after delivery'), 'Returer stänger 30 dagar efter leverans')
    assert.equal(
      localizeMessage('fr', 'Only 2 left of Forma Overshirt in Camel / M. Lower the quantity to continue'),
      'Il ne reste que 2 Forma Overshirt en Camel / M. Réduisez la quantité pour continuer',
    )
  })

  it('translates field errors', () => {
    assert.deepEqual(localizeFields('es', { email: 'Enter a valid email address', qty: 'Use a whole number' }), {
      email: 'Introduce un correo electrónico válido',
      qty: 'Usa un número entero',
    })
  })
})

describe('translated engine and totals', () => {
  it('discount rejections use the translator, English by default', () => {
    const d = discount({ code: 'AUTUMN', minimum: 200 })
    const base = input({ lines: [line({ unit: 50, qty: 1 })], code: d, codeEntered: 'AUTUMN' })
    const english = evaluatePromotions(base).rejected
    assert.ok(english && english.message.startsWith('AUTUMN needs a minimum spend of'))
    const da = evaluatePromotions({ ...base, t: (k, v, f) => serverT('da', k, v, f) }).rejected
    assert.equal(da?.code, english.code)
    assert.ok(da?.message.startsWith('AUTUMN kræver et minimumskøb på'), da?.message)
  })

  it('totals labels translate, English unchanged', () => {
    const lines = [{ total: 40, qty: 1, digital: true }]
    assert.equal(computeTotals(lines).shippingLabel, 'No shipping · digital')
    assert.equal(computeTotals(lines, { t: (k, v, f) => serverT('de', k, v, f) }).shippingLabel, 'Kein Versand · digital')
  })

  it('formats dates in the locale', () => {
    const d = new Date(Date.UTC(2026, 7, 18))
    assert.equal(formatDate(d, 'en'), '18 August 2026')
    assert.equal(formatDate(d, 'de'), '18. August 2026')
    assert.equal(formatDate(d, 'fr'), '18 août 2026')
  })
})
