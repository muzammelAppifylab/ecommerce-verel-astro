/* i18n base (port of VAREL tests/i18n.test.ts, the parts F4 owns): locale picking, structured-field leaf
   translation, placeholder protection and chunking. sourceHash / translateEntity belong to WP-25. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { acceptLanguages, pickLocale } from '../src/server/lib/locale'
import { chunkText, collectLeaves, mask, translateValue, unmask, type BatchTranslator } from '../src/server/lib/i18n/structured'

const mockTranslate = (text: string, to: string) => `[${to}] ${text}`

const mock: BatchTranslator = async (texts) => texts.map((t) => mockTranslate(t, 'da'))

describe('locale picking', () => {
  const enabled = ['en', 'da', 'de', 'fr', 'es', 'sv']
  it('takes the first enabled candidate, by base language', () => {
    assert.equal(pickLocale(['da-DK'], enabled, 'en'), 'da')
    assert.equal(pickLocale([undefined, 'xx', 'DE_at'], enabled, 'en'), 'de')
  })
  it('falls back to the default when nothing is enabled', () => {
    assert.equal(pickLocale(['ja', null, ''], enabled, 'en'), 'en')
    assert.equal(pickLocale(['da'], ['en', 'de'], 'en'), 'en')
  })
  it('orders Accept-Language by quality', () => {
    assert.deepEqual(acceptLanguages('fr;q=0.4, sv-SE, de;q=0.9, *;q=0.1, ja;q=0'), ['sv-SE', 'de', 'fr'])
    assert.equal(pickLocale(acceptLanguages('ja, fr;q=0.5, de;q=0.8'), enabled, 'en'), 'de')
  })
})

describe('structured fields', () => {
  it('translates only text leaves of PostBlock[] (keeps types, images, urls, cites)', async () => {
    const blocks = [
      { type: 'h2', text: 'Made slowly' },
      { type: 'p', text: 'Wool from Jutland.' },
      { type: 'image', image: { src: '/api/media/a.jpg', credit: 'Ida Holm', creditHref: 'https://x.dk' }, caption: 'The studio' },
      { type: 'quote', text: 'Less, better.', cite: 'Mira Holm' },
      { type: 'list', items: ['Wash cold', 'Dry flat'] },
    ]
    assert.deepEqual(collectLeaves(blocks), ['Made slowly', 'Wool from Jutland.', 'The studio', 'Less, better.', 'Wash cold', 'Dry flat'])
    const out = await translateValue(blocks, 'text', mock)
    assert.deepEqual(out, [
      { type: 'h2', text: '[da] Made slowly' },
      { type: 'p', text: '[da] Wool from Jutland.' },
      { type: 'image', image: { src: '/api/media/a.jpg', credit: 'Ida Holm', creditHref: 'https://x.dk' }, caption: '[da] The studio' },
      { type: 'quote', text: '[da] Less, better.', cite: 'Mira Holm' },
      { type: 'list', items: ['[da] Wash cold', '[da] Dry flat'] },
    ])
  })
  it('translates menu labels and homeHero texts, never urls', async () => {
    const menu = [{ label: 'Journal', url: '/journal' }, { label: 'Women', url: '/shop/women' }]
    assert.deepEqual(await translateValue(menu, 'text', mock), [{ label: '[da] Journal', url: '/journal' }, { label: '[da] Women', url: '/shop/women' }])
    const hero = { title: 'Autumn', primaryCta: { label: 'Shop now', url: '/shop' }, image: { src: 'https://cdn/x.jpg', credit: 'A' } }
    assert.deepEqual(await translateValue(hero, 'text', mock), {
      title: '[da] Autumn',
      primaryCta: { label: '[da] Shop now', url: '/shop' },
      image: { src: 'https://cdn/x.jpg', credit: 'A' },
    })
  })
  it('keeps codes, urls and e-mail addresses as they are', async () => {
    assert.equal(await translateValue('STUDIO10', 'text', mock), 'STUDIO10')
    assert.equal(await translateValue('care@varel.studio', 'text', mock), 'care@varel.studio')
    assert.equal(await translateValue('Write to care@varel.studio', 'text', mock), '[da] Write to care@varel.studio')
  })
  it('translates string arrays (return reasons)', async () => {
    assert.deepEqual(await translateValue(['Too small', 'Too large'], 'text', mock), ['[da] Too small', '[da] Too large'])
  })
  it('keeps i18next placeholders in UI catalogs', async () => {
    const cat = { cart: { count_one: '{{count}} item', title: 'Your bag' } }
    assert.deepEqual(await translateValue(cat, 'catalog', mock), { cart: { count_one: '[da] {{count}} item', title: '[da] Your bag' } })
  })
})

describe('placeholders and chunking', () => {
  it('masks variables and email markup, restores them', () => {
    const u = mask('Hello{{#firstName}} {{firstName}}{{/firstName}},', 'email')
    assert.equal(u.masked, 'Hello<x0/> <x1/><x2/>,')
    assert.equal(unmask('Hej<x0/> <x1/><x2/>,', u.tokens), 'Hello'.replace('Hello', 'Hej') + '{{#firstName}} {{firstName}}{{/firstName}},')
    assert.equal(unmask('Hej <x1/>,', u.tokens), null) // lost markers → fallback path
  })
  it('falls back to translating runs when a provider garbles markers', async () => {
    const garble: BatchTranslator = async (texts) => texts.map((t) => `DA ${t.replace(/<x\d+\/>/g, '')}`)
    const out = await translateValue('[View your order]({{orderUrl}})', 'email', garble)
    assert.equal(out, '[DA View your order]({{orderUrl}})')
  })
  it('translates email bodies line by line and leaves structural lines alone', async () => {
    const body = '# Thank you\n\n{{#items}}\n{{name}} | {{meta}} | × {{qty}} | {{total}}\n{{/items}}\n\nSubtotal | {{subtotal}}'
    const out = await translateValue(body, 'email', mock)
    assert.equal(out, '# [da] Thank you\n\n{{#items}}\n{{name}} | {{meta}} | × {{qty}} | {{total}}\n{{/items}}\n\n[da] Subtotal | {{subtotal}}')
  })
  it('chunks long text at sentence boundaries', () => {
    const s = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const chunks = chunkText(s, 200)
    assert.ok(chunks.length > 1)
    assert.ok(chunks.every((c) => c.length <= 200))
    assert.equal(chunks.join(' '), s)
  })
})
