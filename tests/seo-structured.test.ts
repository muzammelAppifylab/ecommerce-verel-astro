import {describe, expect, it, vi} from 'vitest';

// A known site address (dev and the Preview leave absolute URLs out): SITE.url set, as on a custom domain.
vi.mock('../src/content/site', async importOriginal => {
  const real = await importOriginal<typeof import('../src/content/site')>();
  return {...real, SITE: {...real.SITE, url: 'https://shop.example.com'}};
});

const {breadcrumbJsonLd, jsonLdText, ogLocale, siteJsonLd} = await import('../src/lib/seo');

describe('breadcrumbJsonLd', () => {
  it('lists the trail the page shows, with absolute URLs, the last step as the page itself', () => {
    const data = breadcrumbJsonLd(
      [{label: 'Home', href: '/'}, {label: 'Women', href: '/da/shop/women/'}, {label: 'Linen shirt'}],
      '/da/product/linen-shirt/?color=sand'
    );
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {'@type': 'ListItem', position: 1, name: 'Home', item: 'https://shop.example.com/'},
        {'@type': 'ListItem', position: 2, name: 'Women', item: 'https://shop.example.com/da/shop/women/'},
        {'@type': 'ListItem', position: 3, name: 'Linen shirt', item: 'https://shop.example.com/da/product/linen-shirt/'},
      ],
    });
  });

  it('leaves the last step without an item when the page path is not given, and needs two steps', () => {
    const data = breadcrumbJsonLd([{label: 'Home', href: '/'}, {label: 'Journal'}]) as {itemListElement: Record<string, unknown>[]};
    expect(data.itemListElement[1]).toEqual({'@type': 'ListItem', position: 2, name: 'Journal'});
    expect(breadcrumbJsonLd([{label: 'Home', href: '/'}])).toBeNull();
  });

  it('is safe inside a script tag', () => {
    const data = breadcrumbJsonLd([{label: 'Home', href: '/'}, {label: '</script><script>alert(1)</script>'}]);
    expect(jsonLdText(data!)).not.toContain('</script>');
  });
});

describe('siteJsonLd (home Organization)', () => {
  it('adds the store contact and https social profiles only', () => {
    const data = siteJsonLd(
      {
        name: 'VAREL',
        logo: '/images/logo.svg',
        email: 'hello@varel.studio',
        telephone: '+45 12 34 56 78',
        legalName: 'VAREL ApS',
        sameAs: ['https://instagram.com/varel', 'javascript:alert(1)', 'http://insecure.example', 'https://instagram.com/varel'],
      },
      'Modern essentials.',
      'en'
    ) as {'@graph': Record<string, unknown>[]};
    const org = data['@graph'][1];
    expect(org).toMatchObject({
      '@type': 'Organization',
      '@id': 'https://shop.example.com/#organization',
      name: 'VAREL',
      legalName: 'VAREL ApS',
      url: 'https://shop.example.com/',
      logo: 'https://shop.example.com/images/logo.svg',
      email: 'hello@varel.studio',
      telephone: '+45 12 34 56 78',
      sameAs: ['https://instagram.com/varel'],
    });
  });

  it('leaves out empty extras', () => {
    const data = siteJsonLd({name: 'VAREL'}, 'd', 'en') as {'@graph': Record<string, unknown>[]};
    expect(Object.keys(data['@graph'][1]).sort()).toEqual(['@id', '@type', 'name', 'url']);
  });
});

describe('ogLocale', () => {
  it('maps a language to its Open Graph locale', () => {
    expect(ogLocale('en')).toBe('en_US');
    expect(ogLocale('da')).toBe('da_DK');
    expect(ogLocale('sv')).toBe('sv_SE');
    expect(ogLocale('pt-br')).toBe('pt_BR');
    expect(ogLocale('nl')).toBe('nl');
  });
});
