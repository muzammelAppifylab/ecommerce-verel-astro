/* Money at the database boundary (cents ↔ currency units) and formatting, server (src/server/lib/money.ts) and
   storefront (src/lib/format.ts). VAREL's money() output must stay byte-identical. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  fromBasisPoints,
  fromCents,
  fromCentsOrNull,
  isCurrencyCode,
  money,
  num,
  round2,
  setStoreCurrency,
  getStoreCurrency,
  toBasisPoints,
  toCents,
  toCentsOrNull,
} from '../src/server/lib/money'
import { formatDate, formatDateLong, formatMoney, minusMoney, money as clientMoney, photoSrcSet, photoUrl, priceText, slugify } from '../src/lib/format'

describe('cents ↔ currency units', () => {
  it('converts both ways without drift', () => {
    assert.equal(fromCents(14800), 148)
    assert.equal(fromCents(2460), 24.6)
    assert.equal(fromCents(1), 0.01)
    assert.equal(fromCents(null), 0)
    assert.equal(fromCentsOrNull(null), null)
    assert.equal(toCents(148), 14800)
    assert.equal(toCents(24.6), 2460)
    assert.equal(toCents(0.29), 29) // 0.29 * 100 = 28.999999999999996
    assert.equal(toCents(1.005), 101)
    assert.equal(toCents(-14.8), -1480)
    assert.equal(toCentsOrNull(undefined), null)
    for (let c = 0; c < 20000; c += 7) assert.equal(toCents(fromCents(c)), c)
  })
  it('reads Decimal-like values and rounds to cents', () => {
    assert.equal(num({ toString: () => '0.2500' }), 0.25)
    assert.equal(num('12.345'), 12.35)
    assert.equal(num(null), 0)
    assert.equal(num('not a number'), 0)
    assert.equal(round2(0.1 + 0.2), 0.3)
  })
  it('converts basis points', () => {
    assert.equal(fromBasisPoints(2500), 0.25)
    assert.equal(toBasisPoints(0.0825), 825)
  })
})

describe('server money()', () => {
  it('formats like VAREL: whole amounts bare, fractions with two decimals', () => {
    assert.equal(money(148), '$148')
    assert.equal(money(24.6), '$24.60')
    assert.equal(money(1240), '$1,240')
    assert.equal(money(148, 'EUR'), '€148')
    assert.equal(money(148, 'GBP'), '£148')
    assert.equal(money(148, 'DKK').replace(/\s/g, ' '), '148,00 kr.'.replace(',00', '')) // da-DK: "148 kr."
  })
  it('keeps one store currency, ignoring unknown codes', () => {
    const before = getStoreCurrency()
    setStoreCurrency('xx')
    assert.equal(getStoreCurrency(), before)
    setStoreCurrency('eur')
    assert.equal(getStoreCurrency(), 'EUR')
    assert.equal(money(10), '€10')
    setStoreCurrency(before)
    assert.equal(isCurrencyCode('USD'), true)
    assert.equal(isCurrencyCode('U$D'), false)
  })
})

describe('storefront format', () => {
  it('money() in the page language (English output unchanged)', () => {
    assert.equal(clientMoney(148, 'USD', 'en'), '$148')
    assert.equal(clientMoney(24.6, 'USD', 'en'), '$24.60')
    assert.equal(clientMoney(1240.5, 'EUR', 'de').replace(/\s/g, ' '), '1.240,50 €')
    assert.equal(minusMoney(14.8, 'USD', 'en'), '−$14.80')
    assert.equal(priceText(0, 'en'), 'Free')
    assert.equal(priceText(0, 'da'), 'Gratis')
    assert.equal(priceText(12, 'en', 'USD'), '$12')
  })
  it('keeps the template formatMoney (minor units)', () => {
    assert.equal(formatMoney(1999, 'USD'), '$19.99')
    assert.equal(formatMoney(500, 'JPY'), new Intl.NumberFormat('en-US', { style: 'currency', currency: 'JPY' }).format(500))
  })
  it('dates: short and long, UTC, per language', () => {
    const d = '2026-08-18T22:30:00.000Z'
    assert.equal(formatDate(d, 'en'), '18 Aug 2026')
    assert.equal(formatDateLong(d, 'en'), '18 August 2026')
    assert.equal(formatDateLong(d, 'da'), '18. august 2026')
    assert.equal(formatDate('nope', 'en'), '')
    assert.equal(formatDate(null), '')
  })
  it('sizes Unsplash photos only', () => {
    assert.equal(photoUrl({ src: 'https://images.unsplash.com/photo-1' }, 400), 'https://images.unsplash.com/photo-1?auto=format&fit=crop&w=400&q=80')
    assert.equal(photoUrl('/images/a.jpg', 400), '/images/a.jpg')
    assert.equal(photoSrcSet('/images/a.jpg'), '')
    assert.match(photoSrcSet('https://images.unsplash.com/photo-1', [400, 800]), /w=400&q=80 400w, .*w=800&q=80 800w$/)
    assert.equal(slugify('Shoulder Bags'), 'shoulder-bags')
    assert.equal(slugify('Café Crème'), 'cafe-creme')
  })
})
