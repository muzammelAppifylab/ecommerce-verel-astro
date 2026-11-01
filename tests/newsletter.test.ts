import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {newsletterBody} from '../src/server/routes/newsletter';

const subscriberParam = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254).refine(s => s.includes('@')),
});

describe('newsletter body', () => {
  it('trims and lower-cases the email; source is optional and lower-cased', () => {
    expect(newsletterBody.parse({email: '  Ann@Example.DK '})).toEqual({email: 'ann@example.dk', source: null});
    expect(newsletterBody.parse({email: 'a@b.dk', source: 'Footer'})).toEqual({email: 'a@b.dk', source: 'footer'});
  });

  it('rejects bad emails and sources', () => {
    expect(newsletterBody.safeParse({email: 'a@b'}).success).toBe(false);
    expect(newsletterBody.safeParse({email: `${'a'.repeat(250)}@b.dk`}).success).toBe(false);
    expect(newsletterBody.safeParse({email: 'a@b.dk', source: 'foot er'}).success).toBe(false);
    expect(newsletterBody.safeParse({email: 'a@b.dk', source: 'a'.repeat(41)}).success).toBe(false);
  });

  it('subscriber param shape (decoded by Hono) keeps plus addresses', () => {
    expect(subscriberParam.parse({email: decodeURIComponent('A%2Bb@x.dk')}).email).toBe('a+b@x.dk');
    expect(subscriberParam.safeParse({email: 'nobody'}).success).toBe(false);
  });
});
