import {describe, expect, it} from 'vitest';

import {
  FALLBACK_UPDATED,
  asRows,
  clip,
  firstParagraph,
  headingsOf,
  longDate,
  pagePath,
  splitSections,
  storefrontPagePath,
  studioContact,
  topicMailto,
} from '../src/components/pages/policy';
import type {PostBlock} from '../src/lib/types/content';

/** WP-07: the pure helpers behind /privacy/, /terms/, /pages/<slug>/ and /contact/. */
describe('splitSections', () => {
  it('puts blocks before the first heading in the lead and starts a section per heading', () => {
    const body: PostBlock[] = [
      {type: 'p', text: 'Lead'},
      {type: 'list', items: ['a']},
      {type: 'h2', text: 'What we collect'},
      {type: 'p', text: 'One'},
      {type: 'h2', text: 'Your rights'},
      {type: 'p', text: 'Two'},
      {type: 'p', text: 'Three'},
    ];
    const {lead, sections} = splitSections(body);
    expect(lead).toHaveLength(2);
    expect(sections.map(s => s.id)).toEqual(['what-we-collect', 'your-rights']);
    expect(sections[1]!.blocks).toHaveLength(2);
  });

  it('falls back to section-<n> when a heading slugifies to nothing', () => {
    const {sections} = splitSections([
      {type: 'h2', text: 'Intro'},
      {type: 'h2', text: '——'},
    ]);
    expect(sections.map(s => s.id)).toEqual(['intro', 'section-2']);
  });

  it('heading ids equal the contents anchors', () => {
    const body: PostBlock[] = [{type: 'h2', text: 'Prices & tax'}, {type: 'p', text: 'x'}];
    expect(headingsOf(body)).toEqual([{id: 'prices-tax', text: 'Prices & tax'}]);
    expect(splitSections(body).sections[0]!.id).toBe('prices-tax');
  });
});

describe('asRows', () => {
  it('turns "Label — value" lists into rows (em or en dash)', () => {
    expect(asRows(['Payments — Stripe processes card details', 'Carriers – Your address'])).toEqual([
      ['Payments', 'Stripe processes card details'],
      ['Carriers', 'Your address'],
    ]);
  });

  it('is all or nothing', () => {
    expect(asRows(['Payments — Stripe', 'A plain item'])).toBeNull();
    expect(asRows(['No-dash—here'])).toBeNull();
  });

  it('keeps labels to 40 characters', () => {
    expect(asRows([`${'x'.repeat(41)} — too long`])).toBeNull();
  });
});

describe('paths', () => {
  it('maps privacy and terms to their own pages', () => {
    expect(pagePath('privacy')).toBe('/privacy/');
    expect(pagePath('terms')).toBe('/terms/');
    expect(pagePath('shipping-info')).toBe('/pages/shipping-info/');
    expect(storefrontPagePath('terms')).toBe('/terms/');
  });
});

describe('longDate', () => {
  it('writes English day-first', () => {
    expect(longDate(FALLBACK_UPDATED, 'en')).toBe('1 August 2026');
  });

  it('writes other languages in their own form', () => {
    expect(longDate('2026-08-01T09:00:00Z', 'da')).toMatch(/1\.? august 2026/);
    expect(longDate('2026-08-01T09:00:00Z', 'de')).toMatch(/1\. August 2026/);
  });

  it('is empty for an invalid date', () => {
    expect(longDate('nope', 'en')).toBe('');
  });
});

describe('studioContact', () => {
  it('falls back to the studio details', () => {
    expect(studioContact(null)).toEqual({email: 'care@varel.studio', phone: '(+45) 00 00 20 40', phoneHref: 'tel:+4500002040', addressLines: null});
  });

  it('uses the settings and splits the address', () => {
    const c = studioContact({supportEmail: ' hi@x.test ', phone: '+45 12 34', businessAddress: 'Studio 4, 2200 Copenhagen\nDenmark'});
    expect(c.email).toBe('hi@x.test');
    expect(c.phoneHref).toBe('tel:+451234');
    expect(c.addressLines).toEqual(['Studio 4', '2200 Copenhagen', 'Denmark']);
  });

  it('builds topic mail links with an English subject', () => {
    expect(topicMailto('a@b.test', 'Repairs', true)).toBe('mailto:a@b.test?subject=Repairs%20%C2%B7%20Order%20VRL-');
    expect(topicMailto('a@b.test', 'Press', false)).toBe('mailto:a@b.test?subject=Press');
  });
});

describe('descriptions', () => {
  it('uses the first paragraph, clipped on a word', () => {
    expect(firstParagraph([{type: 'h2', text: 'x'}, {type: 'p', text: 'First'}])).toBe('First');
    const long = 'word '.repeat(60);
    const out = clip(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });
});
