import {Breadcrumb, Button, EmptyState, Img, RichText} from '@/components/varel';
import {type Dicts, TextProvider, useLocale, useText} from '@/components/varel/text';
import {collectionsLink, homeLink, shopLink} from '@/lib/links';
import type {CollectionSummary} from '@/lib/types/collections';

import {CollectionCard} from './CollectionCard';

/*
 * The server-rendered parts of `/collections/<slug>/` (VAREL `pages/Collection.tsx`): the hero, the
 * empty-products state, "More collections", and the not-found / failed states. The product grid
 * between them is the `CollectionProducts` island. No hydration here: each part brings its own
 * <TextProvider> with the page's dictionaries.
 */

type Base = {locale: string; dicts: Dicts};

/** Breadcrumb + hero (title, rich description, piece count, the LCP image). */
export function CollectionHero({locale, dicts, collection}: Base & {collection: CollectionSummary & {pieces: number}}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Hero c={collection} />
    </TextProvider>
  );
}

function Hero({c}: {c: CollectionSummary & {pieces: number}}) {
  const t = useText('collections');
  const locale = useLocale();
  return (
    <>
      <div className="px-6 pt-6 md:px-12">
        <Breadcrumb
          items={[
            {label: t('crumbs.home'), href: homeLink(locale)},
            {label: t('crumbs.collections'), href: collectionsLink(locale)},
            {label: c.title},
          ]}
        />
      </div>
      <section className="mt-6 grid grid-cols-1 items-stretch gap-[2px] lg:grid-cols-[1fr_1.15fr]">
        <div className="flex flex-col justify-center gap-5 bg-chalk px-6 py-14 md:px-12 md:py-20">
          <span className="text-label-sm tracking-label text-text-muted uppercase">{t('page.eyebrow')}</span>
          <h1 className="m-0 font-display text-[44px] leading-[1.06] font-normal tracking-display text-balance md:text-[60px]">{c.title}</h1>
          {c.description && <RichText text={c.description} headingLevel={2} className="max-w-[46ch] text-text-secondary" />}
          <span className="text-label-md tracking-label text-text-muted uppercase">{t('pieces', {count: c.pieces})}</span>
        </div>
        <div className="relative min-h-[360px] bg-ink-100 md:min-h-[560px]">
          {c.image && (
            <Img photo={c.image} ratio="fill" width={1600} sizes="(min-width: 1024px) 54vw, 100vw" priority alt={t('imageAlt', {title: c.title})} />
          )}
        </div>
      </section>
    </>
  );
}

/** The collection has no published pieces right now. */
export function CollectionEmpty({locale, dicts}: Base) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Empty />
    </TextProvider>
  );
}

function Empty() {
  const t = useText('collections');
  const locale = useLocale();
  return (
    <EmptyState
      title={t('page.emptyTitle')}
      description={t('page.emptyBody')}
      action={
        <Button variant="outline" href={shopLink(locale)}>
          {t('allProducts')}
        </Button>
      }
    />
  );
}

/** Up to two other collections with pieces, in merchandising order. */
export function CollectionMore({locale, dicts, others}: Base & {others: CollectionSummary[]}) {
  if (!others.length) return null;
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <More others={others} />
    </TextProvider>
  );
}

function More({others}: {others: CollectionSummary[]}) {
  const t = useText('collections');
  const locale = useLocale();
  return (
    <section aria-label={t('page.more')} className="border-t border-hairline px-6 py-16 md:px-12 md:py-24">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <h2 className="m-0 font-display text-display-4 font-normal">{t('page.more')}</h2>
        <a href={collectionsLink(locale)} className="border-0 text-label-md tracking-label uppercase">
          {t('allCollections')}
        </a>
      </div>
      <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-x-6 lg:gap-x-12">
        {others.map((o, i) => (
          <CollectionCard key={o.slug} c={o} index={i} sizes="(min-width: 768px) 46vw, 100vw" />
        ))}
      </div>
    </section>
  );
}

/** Not found (404) or could not be read (503): a message with the way on. */
export function CollectionProblem({locale, dicts, kind, retryHref}: Base & {kind: 'missing' | 'failed'; retryHref: string}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Problem kind={kind} retryHref={retryHref} />
    </TextProvider>
  );
}

function Problem({kind, retryHref}: {kind: 'missing' | 'failed'; retryHref: string}) {
  const t = useText('collections');
  const locale = useLocale();
  return (
    <div className="mx-auto max-w-page px-6 pt-10 pb-24 md:px-12">
      {kind === 'missing' ? (
        <EmptyState
          title={t('page.notFoundHeading')}
          description={t('page.notFoundBody')}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="outline" href={collectionsLink(locale)}>
                {t('allCollections')}
              </Button>
              <Button variant="quiet" href={shopLink(locale)}>
                {t('allProducts')}
              </Button>
            </div>
          }
        />
      ) : (
        <EmptyState
          title={t('page.errorTitle')}
          description={t('errorBody')}
          action={
            <Button variant="outline" href={retryHref}>
              {t('tryAgain')}
            </Button>
          }
        />
      )}
    </div>
  );
}
