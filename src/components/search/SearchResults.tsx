/* The result sections of the search page (VAREL src/pages/Search.tsx, below the result line): loading skeleton,
   no results, tab empty, then products (compact tiles, no quick add, no heart), category chips, journal cards. */
import {Button} from '@/components/varel/Button';
import {EmptyState} from '@/components/varel/EmptyState';
import {Img} from '@/components/varel/Img';
import {ProductGrid, ProductGridSkeleton} from '@/components/varel/ProductGrid';
import {ProductGridItem} from '@/components/varel/ProductGridItem';
import {Skeleton} from '@/components/varel/Skeleton';
import {useText} from '@/components/varel/text';
import {dotJoin} from '@/lib/format';
import {postLink, productLink, shopLink} from '@/lib/links';
import type {SearchTab as Tab} from '@/lib/search-params';
import type {SearchResponse} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {chipCls, headingCls} from './classes';
import {categoryHref, visibleSections} from './search-state';

export interface SearchResultsProps {
  data: SearchResponse | null;
  term: string;
  tab: Tab;
  /** A term and nothing to show yet. */
  loading: boolean;
  /** `data` is the previous answer while the next one loads (dimmed). */
  stale: boolean;
  locale: string;
}

export function SearchResults({data, term, tab, loading, stale, locale}: SearchResultsProps) {
  const t = useText('catalog');
  const products = data?.products ?? [];
  const categories = data?.categories ?? [];
  const posts = data?.posts ?? [];
  const {total, showP, showC, showJ, tabEmpty} = visibleSections(data, tab);

  return (
    <>
      {loading && (
        <div className="flex flex-col gap-5">
          <Skeleton className="h-3 w-28" />
          <ProductGridSkeleton count={4} columns={4} />
        </div>
      )}

      {!!data && !stale && total === 0 && (
        <EmptyState
          className="gap-3.5"
          title={t('search.noResults', {term})}
          description={<span className="block max-w-[44ch]">{t('search.noResultsBody')}</span>}
          action={
            <Button href={shopLink(locale)} variant="outline">
              {t('search.allProducts')}
            </Button>
          }
        />
      )}

      {tabEmpty && <p className="m-0 text-[15px] text-text-secondary">{t('search.tabEmpty', {count: total, term})}</p>}

      <div className={cn('flex flex-col gap-10 transition-opacity duration-200', stale && 'opacity-60')} aria-busy={stale || undefined}>
        {showP && (
          <div className="flex flex-col gap-5">
            <h2 className={headingCls}>{t('search.productsCount', {count: products.length})}</h2>
            <ProductGrid columns={4} className="sm:gap-y-8">
              {products.map(p => (
                <ProductGridItem
                  key={p.id}
                  product={p}
                  href={productLink(p.id, locale)}
                  variant="compact"
                  noAdd
                  noWish
                  meta={dotJoin(p.deptLabel ?? p.dept, p.categoryLabel ?? p.category)}
                  sizes="(min-width: 1024px) 23vw, 50vw"
                />
              ))}
            </ProductGrid>
          </div>
        )}

        {showC && (
          <div className={cn('flex flex-col gap-5', showP && 'border-t border-hairline pt-10')}>
            <h2 className={headingCls}>{t('search.categoriesCount', {count: categories.length})}</h2>
            <div className="flex flex-wrap gap-2">
              {categories.map(c => (
                <a key={`${c.dept}-${c.category}`} href={categoryHref(c, locale)} className={chipCls()}>
                  {dotJoin(c.deptLabel ?? c.dept, c.categoryLabel ?? c.category)} ({c.count})
                </a>
              ))}
            </div>
          </div>
        )}

        {showJ && (
          <div className={cn('flex flex-col gap-5', (showP || showC) && 'border-t border-hairline pt-10')}>
            <h2 className={headingCls}>{t('search.journalCount', {count: posts.length})}</h2>
            <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map(j => (
                <a
                  key={j.slug}
                  href={postLink(j.slug, locale)}
                  data-card="true"
                  className="flex min-w-0 flex-col gap-3 border-0 text-text-primary hover:text-text-primary"
                >
                  <Img photo={j.image} ratio="16/9" width={800} sizes="(min-width: 1024px) 30vw, 100vw" alt={j.title} />
                  <span className="text-label-sm tracking-label text-text-muted uppercase">
                    {dotJoin(j.categoryLabel ?? j.category, j.read)}
                  </span>
                  <span data-name="true" className="self-start font-display text-[22px] leading-display">
                    {j.title}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
