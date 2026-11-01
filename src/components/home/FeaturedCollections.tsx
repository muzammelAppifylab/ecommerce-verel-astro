/* The collections featured on the home page (admin > Collections), the second half of VAREL
   src/pages/home/FeaturedEdit.tsx. Server-rendered only; the page leaves it out when the read failed or no
   featured collection has pieces.

   The card is a local copy of VAREL `pages/collections/CollectionCard.tsx` (`HomeCollectionCard`): WP-05 owns
   the shared `src/components/collections/CollectionCard.tsx`, which was not merged when this was written
   (hand-off Request: swap to it; same props). */
import {Icon, Img} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {collectionLink, collectionsLink} from '@/lib/links';
import {toPlainText} from '@/lib/rich-text';
import type {CollectionSummary} from '@/lib/types/collections';
import {cn} from '@/lib/utils';

import {type HomeProps, HomeText} from './island';
import {featuredCollectionsOf} from './sections';

/** A collection card: 4/5 editorial image, then number · pieces, the title, a short line and "Shop the edit". */
export function HomeCollectionCard({c, index, sizes}: {c: CollectionSummary; index: number; sizes: string}) {
  const t = useText('collections');
  const locale = useLocale();
  const description = c.description ? toPlainText(c.description) : '';
  return (
    <a
      href={collectionLink(c.slug, locale)}
      data-card="true"
      className="group flex min-w-0 flex-col gap-5 border-0 text-text-primary hover:text-text-primary">
      <div data-media="true" className="relative aspect-[4/5] overflow-hidden bg-ink-100">
        {c.image && <Img photo={c.image} alt={t('imageAlt', {title: c.title})} ratio="fill" width={1200} sizes={sizes} />}
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-label-sm tracking-label text-text-muted uppercase">
          {String(index + 1).padStart(2, '0')} · {t('pieces', {count: c.productCount})}
        </span>
        <h3
          data-name="true"
          className="m-0 font-display text-[28px] leading-display font-normal tracking-display md:text-display-4">
          {c.title}
        </h3>
        {description && <p className="m-0 line-clamp-3 max-w-[46ch] text-body-sm text-text-secondary">{description}</p>}
        <span className="mt-1 inline-flex items-center gap-2.5 text-label-sm tracking-label uppercase">
          {t('card.cta')}
          <Icon name="arrow-right" size={14} />
        </span>
      </div>
    </a>
  );
}

function Collections({collections}: {collections: CollectionSummary[]}) {
  const t = useText('home');
  const locale = useLocale();
  const {items, three} = featuredCollectionsOf(collections);
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2.5">
          <span className="text-label-md tracking-loose text-text-secondary uppercase">{t('featuredCollections.eyebrow')}</span>
          <h2 className="m-0 font-display text-[36px] leading-tight font-normal tracking-display md:text-display-3">
            {t('featuredCollections.title')}
          </h2>
        </div>
        <a href={collectionsLink(locale)} className="border-0 text-label-md tracking-label uppercase">
          {t('featuredCollections.all')}
        </a>
      </div>
      <div className={cn('grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-x-6 lg:gap-x-12', three && 'lg:grid-cols-3')}>
        {items.map((c, i) => (
          <div key={c.slug} className={cn(!three && i % 2 === 1 && 'md:mt-20')}>
            <HomeCollectionCard
              c={c}
              index={i}
              sizes={three ? '(min-width: 1024px) 30vw, (min-width: 768px) 50vw, 100vw' : '(min-width: 768px) 46vw, 100vw'}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Renders nothing when no collection qualifies (`featuredCollectionsOf`). */
export function FeaturedCollections({collections, ...props}: HomeProps & {collections: CollectionSummary[]}) {
  if (featuredCollectionsOf(collections).items.length === 0) return null;
  return (
    <HomeText {...props}>
      <Collections collections={collections} />
    </HomeText>
  );
}
