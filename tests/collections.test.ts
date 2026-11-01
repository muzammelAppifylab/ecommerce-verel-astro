import {describe, expect, it} from 'vitest';

import {clipDescription, collectionDescription, collectionJsonLd, socialImage} from '../src/components/collections/seo';
import {
  changedFields,
  collectionFormErrors,
  EMPTY_COLLECTION_FORM,
  inputOfCollection,
} from '../src/portal/screens/collections/editor-form';
import {
  categoryOrderQuery,
  collectionOrderBody,
  createCollectionBody,
  isAllowedImageSrc,
  productOrderBody,
  updateCollectionBody,
} from '../src/server/routes/admin/collections';
import {collectionListQuery, normalizeCollectionSlug} from '../src/server/routes/collections';
import {collectionSummary, type CollectionRow} from '../src/server/lib/collections';

/** WP-05 Collections: pure parts (validators, slug rule, SEO helpers, the editor's form model). */

const fieldErrors = (result: {success: boolean; error?: {issues: {path: PropertyKey[]; message: string}[]}}) =>
  Object.fromEntries((result.error?.issues ?? []).map(i => [i.path.join('.'), i.message]));

describe('public slug and query', () => {
  it('normalizes a slug (trim + lowercase) and refuses impossible ones', () => {
    expect(normalizeCollectionSlug(' Travel-Light ')).toBe('travel-light');
    expect(normalizeCollectionSlug('the-autumn-edit')).toBe('the-autumn-edit');
    for (const bad of ['', 'a--b', '-a', 'a-', 'a b', 'a/b', 'x'.repeat(121), null, undefined]) {
      expect(normalizeCollectionSlug(bad as string)).toBeNull();
    }
    expect(normalizeCollectionSlug('x'.repeat(120))).toBe('x'.repeat(120));
  });

  it('reads ?featured as a boolean, VAREL message otherwise', () => {
    expect(collectionListQuery.parse({}).featured).toBe(false);
    expect(collectionListQuery.parse({featured: ''}).featured).toBe(false);
    expect(collectionListQuery.parse({featured: 'true'}).featured).toBe(true);
    expect(collectionListQuery.parse({featured: '1'}).featured).toBe(true);
    expect(collectionListQuery.parse({featured: 'false'}).featured).toBe(false);
    const bad = collectionListQuery.safeParse({featured: 'maybe'});
    expect(fieldErrors(bad)).toEqual({featured: 'Use featured=true or featured=false'});
  });
});

describe('admin bodies', () => {
  it('create: defaults and text rules', () => {
    const ok = createCollectionBody.parse({title: '  The edit  '});
    expect(ok).toMatchObject({title: 'The edit', description: '', image: null, published: true, featuredOnHome: false, productIds: []});
    expect(ok.slug).toBeUndefined();
    expect(ok.seoTitle).toBeNull();
    expect(createCollectionBody.parse({title: 'x', slug: ''}).slug).toBeUndefined();
    expect(createCollectionBody.parse({title: 'x', slug: 'Autumn-Edit'}).slug).toBe('autumn-edit');
    expect(createCollectionBody.parse({title: 'x', seoTitle: '  '}).seoTitle).toBeNull();

    expect(fieldErrors(createCollectionBody.safeParse({}))).toMatchObject({title: 'Enter a title'});
    expect(fieldErrors(createCollectionBody.safeParse({title: ' '}))).toMatchObject({title: 'Enter a title'});
    expect(fieldErrors(createCollectionBody.safeParse({title: 'x'.repeat(121)}))).toMatchObject({title: 'Keep the title under 120 characters'});
    expect(fieldErrors(createCollectionBody.safeParse({title: 'x', slug: 'a--b'}))).toMatchObject({
      slug: 'Use lowercase letters, numbers and single dashes',
    });
    expect(fieldErrors(createCollectionBody.safeParse({title: 'x', description: 'd'.repeat(10_001)}))).toMatchObject({
      description: 'Keep the description under 10,000 characters',
    });
    expect(fieldErrors(createCollectionBody.safeParse({title: 'x', seoTitle: 's'.repeat(71)}))).toMatchObject({
      seoTitle: 'Keep this under 70 characters',
    });
    expect(createCollectionBody.safeParse({title: 'x', seoDescription: 's'.repeat(170)}).success).toBe(true);
    expect(createCollectionBody.safeParse({title: 'x', seoDescription: 's'.repeat(171)}).success).toBe(false);
  });

  it('create: images are https or this site’s uploads; credit links https only', () => {
    expect(isAllowedImageSrc('https://images.unsplash.com/photo-1')).toBe(true);
    expect(isAllowedImageSrc('/__platform/files/abc')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'http://x.test/a.jpg', '//evil.test/a.jpg', 'data:image/png;base64,AA']) {
      expect(isAllowedImageSrc(bad)).toBe(false);
    }
    const img = (image: unknown) => createCollectionBody.safeParse({title: 'x', image});
    expect(img({src: 'https://x.test/a.jpg'}).data?.image).toEqual({src: 'https://x.test/a.jpg', credit: '', creditHref: ''});
    expect(fieldErrors(img({src: 'javascript:alert(1)'}))).toMatchObject({'image.src': 'Use an https URL or an uploaded image'});
    expect(fieldErrors(img({src: 'https://x.test/a.jpg', creditHref: 'javascript:x'}))).toMatchObject({'image.creditHref': 'Use an https link'});
    expect(img(null).success).toBe(true);
  });

  it('create: product ids unique and at most 100', () => {
    expect(fieldErrors(createCollectionBody.safeParse({title: 'x', productIds: ['a', 'a']}))).toMatchObject({
      productIds: 'Each of the products can appear once',
    });
    const many = Array.from({length: 101}, (_, i) => `p-${i}`);
    expect(fieldErrors(createCollectionBody.safeParse({title: 'x', productIds: many}))).toMatchObject({productIds: 'Use 100 products or fewer'});
    expect(createCollectionBody.safeParse({title: 'x', productIds: many.slice(0, 100)}).success).toBe(true);
  });

  it('update: every field optional, no defaults, null image removes it', () => {
    expect(updateCollectionBody.parse({})).toEqual({});
    expect(updateCollectionBody.parse({published: false})).toEqual({published: false});
    expect(updateCollectionBody.parse({image: null})).toEqual({image: null});
    expect(updateCollectionBody.safeParse({title: ''}).success).toBe(false);
  });

  it('order and category bodies', () => {
    expect(collectionOrderBody.parse({ids: ['2', 1]}).ids).toEqual([2, 1]);
    expect(fieldErrors(collectionOrderBody.safeParse({ids: []}))).toMatchObject({ids: 'Send at least one collection'});
    expect(fieldErrors(collectionOrderBody.safeParse({ids: ['1', 1]}))).toMatchObject({ids: 'Each of the collections can appear once'});
    expect(collectionOrderBody.safeParse({ids: ['abc']}).success).toBe(false);
    expect(categoryOrderQuery.parse({category: '3'}).category).toBe(3);
    expect(fieldErrors(categoryOrderQuery.safeParse({category: 'x'}))).toMatchObject({category: 'Choose a category'});
    expect(fieldErrors(categoryOrderQuery.safeParse({}))).toMatchObject({category: 'Choose a category'});
    expect(fieldErrors(productOrderBody.safeParse({category: 1, productIds: []}))).toMatchObject({productIds: 'Send at least one product'});
  });
});

describe('collectionSummary', () => {
  const photo = (src: string) => ({src, credit: '', creditHref: ''});
  const row = (over: Partial<CollectionRow> = {}): CollectionRow =>
    ({
      id: 1,
      slug: 'travel-light',
      title: 'Travel light',
      description: 'Pieces for the road',
      image: null,
      published: true,
      featuredOnHome: true,
      position: 0,
      seoTitle: null,
      seoDescription: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      products: [
        {productId: 'draft', position: 0, product: {id: 'draft', status: 'draft', images: [photo('https://x.test/draft.jpg')]}},
        {productId: 'a', position: 1, product: {id: 'a', status: 'published', images: [photo('https://x.test/a.jpg')]}},
        {productId: 'b', position: 2, product: {id: 'b', status: 'published', images: []}},
      ],
      ...over,
    }) as CollectionRow;

  it('falls back to the first published product photo and counts published products only', () => {
    const s = collectionSummary(row());
    expect(s.image?.src).toBe('https://x.test/a.jpg');
    expect(s.productCount).toBe(2);
    expect(collectionSummary(row({image: photo('https://x.test/own.jpg')})).image?.src).toBe('https://x.test/own.jpg');
    expect(collectionSummary(row({products: []})).image).toBeNull();
  });

  it('overlays translations, keeps a null SEO title null', () => {
    const m = new Map([['1\u0000title', 'Rejs let']]);
    const s = collectionSummary(row(), m);
    expect(s.title).toBe('Rejs let');
    expect(s.description).toBe('Pieces for the road');
    expect(s.seoTitle).toBeNull();
  });
});

describe('SEO helpers', () => {
  it('clips at a word boundary with an ellipsis', () => {
    expect(clipDescription('  short   text ')).toBe('short text');
    const long = 'word '.repeat(60);
    const clipped = clipDescription(long);
    expect(clipped.length).toBeLessThanOrEqual(160);
    expect(clipped.endsWith('word…')).toBe(true);
    expect(clipDescription(`${'a'.repeat(150)}, ${'b'.repeat(40)}`)).toBe(`${'a'.repeat(150)}…`);
  });

  it('picks the description: SEO text, then plain description, then the fallback', () => {
    expect(collectionDescription({seoDescription: 'SEO', description: '<p>Body</p>'})).toBe('SEO');
    expect(collectionDescription({seoDescription: null, description: 'Body text'})).toBe('Body text');
    expect(collectionDescription({seoDescription: null, description: ''}, 'Store')).toBe('Store');
  });

  it('crops Unsplash share images, keeps own paths, drops unsafe ones', () => {
    expect(socialImage('https://images.unsplash.com/photo-1')).toBe(
      'https://images.unsplash.com/photo-1?auto=format&fit=crop&w=1200&h=630&q=80'
    );
    expect(socialImage('https://images.unsplash.com/photo-1?w=800')).toBe('https://images.unsplash.com/photo-1?w=800');
    expect(socialImage('/__platform/files/x')).toBe('/__platform/files/x');
    expect(socialImage('//evil.test/x')).toBeNull();
    expect(socialImage('http://x.test/a.jpg')).toBeNull();
    expect(socialImage(null)).toBeNull();
  });

  it('builds a CollectionPage JSON-LD', () => {
    expect(collectionJsonLd({name: 'Travel light', description: 'd', url: 'https://s.test/collections/travel-light/', locale: 'en'})).toEqual({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Travel light',
      description: 'd',
      url: 'https://s.test/collections/travel-light/',
      inLanguage: 'en',
    });
    expect(collectionJsonLd({name: 'x', description: '', url: null, locale: 'da'})).not.toHaveProperty('url');
  });
});

describe('editor form model', () => {
  const form = {...EMPTY_COLLECTION_FORM, title: '  Edit ', slug: ' ', seoTitle: ' ', seoDescription: ' Desc '};

  it('trims, nulls empty SEO text and leaves an empty slug out', () => {
    expect(inputOfCollection(form)).toEqual({
      title: 'Edit',
      slug: undefined,
      description: '',
      image: null,
      published: true,
      featuredOnHome: false,
      seoTitle: null,
      seoDescription: 'Desc',
      productIds: [],
    });
  });

  it('an edit sends only the changed fields', () => {
    const before = inputOfCollection(form);
    const after = inputOfCollection({...form, published: false, seoTitle: 'New'});
    expect(changedFields(after, before)).toEqual({published: false, seoTitle: 'New'});
    expect(changedFields(before, before)).toEqual({});
  });

  it('client rules mirror the server, server errors fill the rest', () => {
    const errors = collectionFormErrors({...EMPTY_COLLECTION_FORM, slug: 'Bad Slug', seoTitle: 'x'.repeat(71)}, true, {productIds: 'We cannot find x'});
    expect(errors).toMatchObject({
      title: 'Enter a title',
      slug: 'Use lowercase letters, numbers and single dashes',
      seoTitle: 'Keep the SEO title under 70 characters',
      productIds: 'We cannot find x',
    });
    expect(collectionFormErrors(EMPTY_COLLECTION_FORM, false, {}).title).toBeUndefined();
  });
});
