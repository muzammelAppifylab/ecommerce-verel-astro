/*
 * Not found — VAREL `src/pages/NotFound.tsx` (404.dc.html), as server HTML (no client JS): the search is a
 * plain GET form to /search/, the picks ("In the studio now") are read on the server by the page.
 *
 * Other packages render it for their own 404 (product, journal post, collection, CMS page):
 *   <NotFoundView locale={locale} dicts={dictsFor(locale, {notfound: true, layout: ['ui']})} picks={picks} />
 * `picks`: up to 4 products (`GET /site-api/products?tag=new&limit=4`), or null / [] to hide the section.
 */
import {Icon} from '@/components/varel/Icon';
import {Img} from '@/components/varel/Img';
import {ProductTile} from '@/components/varel/ProductTile';
import {TextProvider, useLocale, useText, type Dicts} from '@/components/varel/text';
import {priceText} from '@/lib/format';
import {deptLink, href, productLink} from '@/lib/links';
import type {Product} from '@/lib/types/catalog';

import {ABOUT_PHOTOS} from './photos';

const labelCls = 'text-label-sm tracking-label uppercase';

/** What the picks need of a product (`Product` from the product list). */
export type NotFoundPick = Pick<Product, 'id' | 'name' | 'image' | 'price' | 'category'> & {alt?: string; categoryLabel?: string};

function NotFoundContent({picks}: {picks: NotFoundPick[] | null}) {
  const t = useText('notfound');
  const locale = useLocale();
  const items = (picks ?? []).slice(0, 4);
  /** Labels: `notfound:quick.<key>` */
  const quick: [string, string][] = [
    ['women', deptLink('women', locale)],
    ['men', deptLink('men', locale)],
    ['journal', href('/journal/', locale)],
    ['contact', href('/contact/', locale)],
  ];
  return (
    <div className="mx-auto max-w-page">
      <section className="grid items-stretch gap-0.5 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col justify-center gap-6 bg-chalk px-6 py-16 md:px-12 md:py-24">
          <span className="font-display text-[72px] leading-none text-text-muted md:text-[96px]" aria-hidden="true">
            404
          </span>
          <h1 className="m-0 font-display text-[36px] leading-tight font-normal tracking-display md:text-[48px]">{t('heading')}</h1>
          <p className="m-0 max-w-[42ch] text-body-md text-text-secondary">{t('body')}</p>
          <form role="search" method="get" action={href('/search/', locale)} className="mt-2 flex max-w-[400px] gap-4 border-b border-strong">
            <input
              type="search"
              name="q"
              maxLength={200}
              placeholder={t('searchPlaceholder')}
              aria-label={t('search')}
              className="flex-1 rounded-none border-0 bg-transparent py-3 text-body-md text-text-primary outline-none focus-visible:outline-none"
            />
            <button type="submit" aria-label={t('search')} className="flex border-0 bg-transparent p-1.5 hover:text-ink-500">
              <Icon name="search" size={18} />
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-3">
            <a href={href('/shop/', locale)} className={`${labelCls} border-0 bg-ink-900 px-6 py-[15px] text-text-inverse hover:bg-ink-700 hover:text-text-inverse`}>
              {t('allProducts')}
            </a>
            <a
              href={href('/', locale)}
              className={`${labelCls} border border-strong px-6 py-[15px] text-text-primary hover:border-strong hover:bg-ink-900 hover:text-text-inverse`}>
              {t('home')}
            </a>
          </div>
          <nav aria-label={t('popular')} className="mt-3 flex flex-wrap gap-5">
            {quick.map(([key, to]) => (
              <a key={key} href={to} className={`${labelCls} border-b border-hairline pb-[3px] text-text-primary`}>
                {t(`quick.${key}`)}
              </a>
            ))}
          </nav>
        </div>
        <div className="relative hidden min-h-[620px] bg-ink-100 lg:block">
          <Img photo={ABOUT_PHOTOS.hero} alt={t('alt')} ratio="fill" width={1400} sizes="52vw" priority media={false} />
        </div>
      </section>

      {items.length > 0 && (
        <section className="flex flex-col gap-7 px-6 pt-14 pb-16 md:px-12 md:pt-[72px] md:pb-24">
          <div className="flex items-baseline justify-between gap-8">
            <h2 className="m-0 font-display text-[28px] font-normal md:text-[34px]">{t('picks')}</h2>
            <a href={href('/shop/', locale)} className={`${labelCls} shrink-0 border-b border-strong pb-1 text-text-primary hover:border-strong`}>
              {t('allProducts')}
            </a>
          </div>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {items.map(p => (
              <ProductTile
                key={p.id}
                variant="compact"
                name={p.name}
                href={productLink(p.id, locale)}
                photo={p.image}
                alt={p.alt}
                price={priceText(p.price, locale)}
                meta={p.categoryLabel ?? p.category}
                sizes="(min-width: 1024px) 24vw, 50vw"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function NotFoundView({locale, dicts, picks}: {locale: string; dicts: Dicts; picks: NotFoundPick[] | null}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <NotFoundContent picks={picks} />
    </TextProvider>
  );
}
