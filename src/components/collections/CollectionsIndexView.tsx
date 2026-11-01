import {Breadcrumb, Button, EmptyState} from '@/components/varel';
import {type Dicts, TextProvider, useLocale, useText} from '@/components/varel/text';
import {homeLink, shopLink} from '@/lib/links';
import type {CollectionSummary} from '@/lib/types/collections';

import {CollectionCard} from './CollectionCard';

/**
 * `/collections/`: every published collection with pieces in it, in the studio's order (VAREL
 * `pages/Collections.tsx`). Server-rendered without hydration: `list === null` is the read-failed
 * state (the page answers 503), `retryHref` reloads the page.
 */
export function CollectionsIndexView({
  locale,
  dicts,
  list,
  retryHref,
}: {
  locale: string;
  dicts: Dicts;
  list: CollectionSummary[] | null;
  retryHref: string;
}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Body list={list} retryHref={retryHref} />
    </TextProvider>
  );
}

function Body({list, retryHref}: {list: CollectionSummary[] | null; retryHref: string}) {
  const t = useText('collections');
  const locale = useLocale();
  return (
    <div className="mx-auto max-w-page">
      <div className="px-6 pt-6 md:px-12">
        <Breadcrumb items={[{label: t('crumbs.home'), href: homeLink(locale)}, {label: t('crumbs.collections')}]} />
      </div>
      <header className="grid gap-6 border-b border-hairline px-6 pt-8 pb-10 md:px-12 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-12">
        <div className="flex flex-col gap-4">
          <h1 className="m-0 font-display text-[40px] leading-tight font-normal lg:text-[56px]">{t('index.title')}</h1>
          <p className="m-0 max-w-[52ch] text-[15px] text-text-secondary">{t('index.intro')}</p>
        </div>
        <span className="text-label-md tracking-label text-text-muted uppercase">{list ? t('index.count', {count: list.length}) : ' '}</span>
      </header>

      <section className="px-6 pt-12 pb-24 md:px-12 md:pt-16">
        {list === null ? (
          <EmptyState
            title={t('index.errorTitle')}
            description={t('errorBody')}
            action={
              <Button variant="outline" href={retryHref}>
                {t('tryAgain')}
              </Button>
            }
          />
        ) : list.length === 0 ? (
          <EmptyState
            title={t('index.emptyTitle')}
            description={t('index.emptyBody')}
            action={
              <Button variant="outline" href={shopLink(locale)}>
                {t('allProducts')}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-x-6 lg:grid-cols-3 lg:gap-x-12 lg:gap-y-16">
            {list.map((c, i) => (
              <CollectionCard key={c.slug} c={c} index={i} sizes="(min-width: 1024px) 30vw, (min-width: 768px) 50vw, 100vw" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
