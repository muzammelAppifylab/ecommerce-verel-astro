/* Rich text descriptions: HTML (editor) and older Markdown → plain text for meta tags (worker) and previews (storefront),
   HTML detection, link allowlist. */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { toPlainText as serverPlain } from '../src/server/lib/rich-text'
import { isRichHtml, safeHref, toPlainText } from '../src/lib/rich-text'

const MD = `## The fabric

Woven from **Irish linen** with a *soft* hand.

- Relaxed fit
- Mother-of-pearl buttons

> Made to be worn for years.

Care: see [our guide](/care).`

describe('rich text', () => {
  for (const [name, plain] of [
    ['storefront', toPlainText],
    ['worker', serverPlain],
  ] as const) {
    it(`${name}: strips Markdown to one line of words`, () => {
      assert.equal(
        plain(MD),
        'The fabric Woven from Irish linen with a soft hand. Relaxed fit Mother-of-pearl buttons Made to be worn for years. Care: see our guide.',
      )
    })
    it(`${name}: plain text written before the editor passes through`, () => {
      assert.equal(plain('A coat for wet Copenhagen winters.\nFully lined & taped seams.'), 'A coat for wet Copenhagen winters. Fully lined & taped seams.')
    })
    it(`${name}: editor HTML becomes words, styles and tags dropped`, () => {
      const html =
        '<h1 style="text-align: center">The fabric</h1><p>Woven from <strong>Irish</strong> <span style="color: #8A3A2E">linen</span>' +
        ' &amp; <mark data-color="#ECECEC">silk</mark>, 20 m<sup>2</sup>.</p><ul><li><p>Relaxed fit</p></li><li><p>Buttons</p></li></ul>'
      assert.equal(plain(html), 'The fabric Woven from Irish linen & silk, 20 m2. Relaxed fit Buttons')
    })
    it(`${name}: empty stays empty`, () => {
      assert.equal(plain(''), '')
      assert.equal(plain('   '), '')
    })
  }

  it('tells editor HTML from older Markdown and plain text', () => {
    assert.equal(isRichHtml('<p>Linen</p>'), true)
    assert.equal(isRichHtml('<h3 style="text-align: right">Fit</h3>'), true)
    assert.equal(isRichHtml('## Fit\n\nRelaxed'), false)
    assert.equal(isRichHtml('Under <5% shrinkage'), false)
  })

  it('allows web, mail, phone and on-site links only', () => {
    assert.equal(safeHref('https://varel.studio'), 'https://varel.studio')
    assert.equal(safeHref('mailto:studio@varel.com'), 'mailto:studio@varel.com')
    assert.equal(safeHref('/collections/winter'), '/collections/winter')
    assert.equal(safeHref('javascript:alert(1)'), null)
    assert.equal(safeHref('data:text/html,hi'), null)
    assert.equal(safeHref('//evil.example'), null)
  })
})

describe('rich text translation', () => {
  it('sends description HTML to the translator with its tags masked', async () => {
    const { modeFor, translateValue } = await import('../src/server/lib/i18n/structured')
    assert.equal(modeFor('product', 'description'), 'catalog')
    assert.equal(modeFor('product', 'name'), 'text')
    const seen: string[] = []
    const upper = async (texts: string[]) => texts.map((t) => (seen.push(t), t.replace(/[a-z]+/g, (w) => w.toUpperCase())))
    const out = await translateValue('<p>Soft <strong>linen</strong> shirt</p>', modeFor('product', 'description'), upper)
    assert.equal(out, '<p>SOFT <strong>LINEN</strong> SHIRT</p>')
    assert.ok(seen.every((t) => !t.includes('strong')), 'tag names never reach the translator')
  })
})
