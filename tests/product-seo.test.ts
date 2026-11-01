import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {absImage, availabilityOf, clip, metaDescription, productJsonLd} from '../src/components/product/seo';
import {RichText} from '../src/components/varel/RichText';
import type {Product} from '../src/lib/types/catalog';

/** WP-03: product page SEO (port of VAREL worker/routes/html.ts) and the static Details body. */

const abs = (path: string) => `https://shop.example.test${path}`;

const base = {
  id: 'forma-overshirt',
  name: 'Forma Overshirt',
  brand: 'VAREL',
  dept: 'Women',
  category: 'Shirts',
  categoryLabel: 'Shirts',
  type: 'physical',
  price: 148,
  compareAt: null,
  sku: 'FO-1',
  short: 'A boxy overshirt in washed linen.',
  description: '## Cut\n\nA boxy overshirt in **washed** linen.',
  material: 'Linen',
  care: null,
  tags: [],
  download: null,
  image: {src: 'https://images.unsplash.com/photo-1', credit: '', creditHref: ''},
  gallery: [{src: 'https://images.unsplash.com/photo-1', credit: '', creditHref: ''}],
  variants: [
    {id: 'A', color: 'Stone', size: 'M', swatch: null, options: {}, price: 148, inventory: 3},
    {id: 'B', color: 'Stone', size: 'L', swatch: null, options: {}, price: 148, inventory: 0},
  ],
  options: [],
  stock: 'in',
  stockLabel: 'In stock',
  badge: null,
  onSale: false,
  swatches: [],
  sizes: ['M', 'L'],
  alt: 'Forma Overshirt — shirts by VAREL',
  createdAt: '2026-01-01T00:00:00.000Z',
  promotion: null,
  rating: null,
  seoTitle: null,
  seoDescription: null,
} as unknown as Product;

const opts = {canonical: 'https://shop.example.test/product/forma-overshirt/', currency: 'EUR', storeName: 'VAREL', locale: 'en', abs};

describe('clip', () => {
  it('keeps short text and cuts long text at a word boundary with an ellipsis', () => {
    expect(clip('  a   short\nline ')).toBe('a short line');
    const long = `${'word '.repeat(50)}end.`;
    const cut = clip(long, 60);
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/[,.;:\s]…$/);
    expect(clip('Hello, world. This is long enough to cut', 20)).toBe('Hello, world. This…');
  });
});

describe('absImage', () => {
  it('crops Unsplash bases for share cards, makes on-site paths absolute, drops unknowns', () => {
    expect(absImage('https://images.unsplash.com/photo-1', abs)).toBe(
      'https://images.unsplash.com/photo-1?auto=format&fit=crop&w=1200&h=630&q=80'
    );
    expect(absImage('https://images.unsplash.com/photo-1?w=400', abs)).toBe('https://images.unsplash.com/photo-1?w=400');
    expect(absImage('/images/x.jpg', abs)).toBe('https://shop.example.test/images/x.jpg');
    expect(absImage('/images/x.jpg', () => null)).toBeNull();
    expect(absImage(null, abs)).toBeNull();
    expect(absImage('http://insecure.example/x.jpg', abs)).toBeNull();
  });
});

describe('metaDescription', () => {
  it('prefers the SEO override, then short, then the description, then the store default', () => {
    expect(metaDescription({...base, seoDescription: 'Override'})).toBe('Override');
    expect(metaDescription(base)).toBe('A boxy overshirt in washed linen.');
    expect(metaDescription({...base, short: ''})).toBe('Cut A boxy overshirt in washed linen.');
    expect(metaDescription({...base, short: '', description: ''}, 'Store text')).toBe('Store text');
  });
});

describe('productJsonLd', () => {
  it('one price → Offer; in stock when any variant has stock', () => {
    const ld = productJsonLd(base, opts);
    expect(ld['@type']).toBe('Product');
    expect(ld.offers).toEqual({
      '@type': 'Offer',
      price: '148.00',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: opts.canonical,
    });
    expect(ld.brand).toEqual({'@type': 'Brand', name: 'VAREL'});
    expect(ld.image).toEqual(['https://images.unsplash.com/photo-1?auto=format&fit=crop&w=1200&h=630&q=80']);
    expect(ld).not.toHaveProperty('aggregateRating');
  });

  it('differing variant prices → AggregateOffer with offerCount; ratings when present', () => {
    const p = {
      ...base,
      variants: [base.variants[0]!, {...base.variants[1]!, price: 168}],
      rating: {avg: 4.5, count: 12},
    } as Product;
    const ld = productJsonLd(p, opts);
    expect(ld.offers).toMatchObject({'@type': 'AggregateOffer', lowPrice: '148.00', highPrice: '168.00', offerCount: 2});
    expect(ld.aggregateRating).toEqual({'@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 12});
  });

  it('availability: OutOfStock, BackOrder, digital InStock', () => {
    const none = {...base, variants: base.variants.map(v => ({...v, inventory: 0}))} as Product;
    expect(availabilityOf(none)).toBe('OutOfStock');
    expect(availabilityOf({...none, allowBackorder: true})).toBe('BackOrder');
    expect(availabilityOf({...none, type: 'digital'})).toBe('InStock');
    expect(availabilityOf({...none, variants: [{...none.variants[0]!, inventory: null}]})).toBe('InStock');
  });
});

describe('Details body (static RichText)', () => {
  const html = (text: string) => renderToStaticMarkup(createElement(RichText, {text, headingLevel: 2, size: 'sm'}));

  it('Markdown and HTML headings start at h2', () => {
    expect(html('# Title\n\nBody')).toContain('<h2');
    expect(html('<h1>Title</h1><p>Body</p>')).toContain('<h2');
  });

  it('drops scripts, unsafe links and inline styles (CSP)', () => {
    const out = html('<p>Hi <a href="javascript:alert(1)">x</a></p><script>alert(1)</script><p style="color: red">y</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('style=');
  });
});
