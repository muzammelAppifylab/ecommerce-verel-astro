import {describe, expect, it} from 'vitest';

import {headingIds, headingsOf, quoteText} from '../src/components/journal/headings';
import {clip} from '../src/components/journal/seo';
import type {PostBlock} from '../src/lib/types/content';
import {blockFromPost, blockToPost, formToInput, listItems, newForm, validate} from '../src/portal/screens/journal/form';
import {createSchema, patchSchema, postsKeyset, readTime} from '../src/server/routes/admin/posts';

/** Journal (WP-06) pure pieces: reading time, heading ids, clip, input rules, keyset builder. */

const words = (n: number) => Array.from({length: n}, () => 'w').join(' ');
const image = {src: 'https://images.unsplash.com/x', credit: '', creditHref: ''};
const valid = {title: 'T', category: 'Care', author: 'A', status: 'draft', excerpt: 'E', image, body: [{type: 'p', text: 'x'}]};

describe('readTime', () => {
  it('rounds up at 200 words, minimum one minute', () => {
    expect(readTime([])).toBe('1 min read');
    expect(readTime([{type: 'p', text: words(200)}])).toBe('1 min read');
    expect(readTime([{type: 'p', text: words(201)}])).toBe('2 min read');
  });
  it('counts list items and image captions, splitting on any whitespace', () => {
    const body: PostBlock[] = [
      {type: 'list', items: [words(150), words(50)]},
      {type: 'image', image, caption: 'one\ttwo\nthree'},
    ];
    expect(readTime(body)).toBe('2 min read');
  });
});

describe('headings', () => {
  it('slugs, de-duplicates and falls back for non-Latin text', () => {
    const body: PostBlock[] = [
      {type: 'p', text: 'intro'},
      {type: 'h2', text: 'The Weave'},
      {type: 'h2', text: 'The weave'},
      {type: 'h2', text: 'Ткань'},
    ];
    expect(headingsOf(body)).toEqual([
      {id: 'the-weave', text: 'The Weave'},
      {id: 'the-weave-2', text: 'The weave'},
      {id: 'section-3', text: 'Ткань'},
    ]);
    // Same ids by block index as the body uses.
    expect([...headingIds(body).entries()]).toEqual([
      [1, 'the-weave'],
      [2, 'the-weave-2'],
      [3, 'section-3'],
    ]);
  });
  it('strips one pair of quote marks', () => {
    expect(quoteText('“Linen breathes.”')).toBe('Linen breathes.');
    expect(quoteText('"Plain"')).toBe('Plain');
  });
});

describe('clip', () => {
  it('keeps short text and cuts long text at a word with an ellipsis', () => {
    expect(clip('Short  text ')).toBe('Short text');
    const out = clip(`${words(10)} ${'lorem ipsum, '.repeat(20)}`, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/[,\s]…$/);
  });
});

describe('admin input rules', () => {
  const issues = (r: {success: boolean; error?: {issues: {path: PropertyKey[]}[]}}) => (r.error?.issues ?? []).map(i => i.path.join('.'));

  it('accepts a minimal post and applies limits', () => {
    expect(createSchema.safeParse(valid).success).toBe(true);
    expect(createSchema.safeParse({...valid, title: 'x'.repeat(160)}).success).toBe(true);
    expect(issues(createSchema.safeParse({...valid, title: 'x'.repeat(161)}))).toContain('title');
    expect(issues(createSchema.safeParse({...valid, category: 'x'.repeat(61)}))).toContain('category');
    expect(issues(createSchema.safeParse({...valid, author: 'x'.repeat(81)}))).toContain('author');
    expect(issues(createSchema.safeParse({...valid, excerpt: 'x'.repeat(321)}))).toContain('excerpt');
    expect(issues(createSchema.safeParse({...valid, seoTitle: 'x'.repeat(71)}))).toContain('seoTitle');
    expect(issues(createSchema.safeParse({...valid, seoDescription: 'x'.repeat(201)}))).toContain('seoDescription');
  });

  it('refuses reserved and malformed slugs', () => {
    expect(issues(createSchema.safeParse({...valid, slug: 'feed'}))).toContain('slug');
    expect(issues(createSchema.safeParse({...valid, slug: 'Bad slug'}))).toContain('slug');
    expect(createSchema.safeParse({...valid, slug: 'good-slug-2'}).success).toBe(true);
  });

  it('wants https or uploaded images and keys block errors by index', () => {
    expect(issues(createSchema.safeParse({...valid, image: {src: 'http://x'}}))).toContain('image.src');
    expect(createSchema.safeParse({...valid, image: {src: '/__platform/files/abc'}}).success).toBe(true);
    const r = createSchema.safeParse({...valid, body: [{type: 'p', text: 'ok'}, {type: 'h2', text: ''}, {type: 'nope'}]});
    expect(issues(r)).toEqual(expect.arrayContaining(['body.1.text', 'body.2.type']));
    expect(issues(createSchema.safeParse({...valid, body: []}))).toContain('body');
  });

  it('patch is partial; empty SEO clears', () => {
    const r = patchSchema.safeParse({seoTitle: ''});
    expect(r.success && r.data.seoTitle).toBe(null);
    expect(patchSchema.safeParse({}).success).toBe(true);
  });

  it('client rules agree with the server on the same keys', () => {
    const f = {...newForm('A'), title: 'T', category: 'Care', excerpt: 'E', imageSrc: 'http://x'};
    const errs = validate(formToInput(f, true));
    expect(Object.keys(errs)).toEqual(expect.arrayContaining(['image.src', 'body.0.text']));
    expect(validate(formToInput({...f, imageSrc: image.src, body: [blockFromPost({type: 'p', text: 'x'})]}, true))).toEqual({});
  });

  it('round-trips blocks through the editor model', () => {
    const blocks: PostBlock[] = [
      {type: 'quote', text: 'Q', cite: 'C'},
      {type: 'image', image: {src: image.src, credit: 'cr', creditHref: ''}, caption: 'cap'},
      {type: 'list', items: ['a', 'b']},
    ];
    expect(blocks.map(blockFromPost).map(blockToPost)).toEqual(blocks);
    expect(listItems('- a\n* b\n\n• c')).toEqual(['a', 'b', 'c']);
  });
});

describe('admin keyset', () => {
  it('orders publishedAt with nulls last and pages across the null boundary', () => {
    const d = postsKeyset('publishedAt', 'desc', null);
    expect(d.orderBy).toEqual([{publishedAt: {sort: 'desc', nulls: 'last'}}, {id: 'desc'}]);
    expect(d.where).toEqual({});
    const after = postsKeyset('publishedAt', 'desc', ['2026-01-01T00:00:00.000Z', 5]);
    expect(after.where).toEqual({
      OR: [
        {publishedAt: {lt: new Date('2026-01-01T00:00:00.000Z')}},
        {publishedAt: new Date('2026-01-01T00:00:00.000Z'), id: {lt: 5}},
        {publishedAt: null},
      ],
    });
    expect(postsKeyset('publishedAt', 'asc', [null, 9]).where).toEqual({publishedAt: null, id: {gt: 9}});
  });
});
