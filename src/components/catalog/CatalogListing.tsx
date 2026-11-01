import {useEffect} from 'react';

import {Button, dotJoin, type Dicts, EmptyState, TextProvider, useText} from '@/components/varel';
import type {Product} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {ActiveFilterChips} from './ActiveFilterChips';
import {FilterPanel} from './FilterPanel';
import {FilterTrigger} from './FilterTrigger';
import {
  CATEGORY_SORTS,
  type CatalogListing as CatalogListingData,
  type FacetKey,
  type ListingBase,
  type ListingMode,
  listingQueryString,
  type ListingScope,
  type ListingSearch,
} from './listing';
import {ProductResults} from './ProductResults';
import {SortSelect} from './SortSelect';
import {type ListingData, type ListingState, useListingState} from './useListingState';

/** A category chip on department / category pages ("All women", "Shirts (2)"): its page path without a query. */
export interface CategoryChip {
  label: string;
  path: string;
  current: boolean;
}

export interface CatalogListingProps {
  mode: ListingMode;
  locale: string;
  /** catalog, product, common, layout */
  dicts: Dicts;
  /** Route slugs (none on Shop) */
  scope: ListingScope;
  /** From the server render, so first paint needs no fetch */
  initial: {
    search: ListingSearch;
    /** null = the server read failed */
    list: CatalogListingData | null;
    base: ListingBase | null;
  };
  /** Shop mode: the page heading and intro (server text, rendered in this island's HTML) */
  heading?: string;
  intro?: string;
  /** Category mode: the category chips row */
  chips?: CategoryChip[];
  /** Category mode: "All products" link of the empty state */
  shopHref?: string;
}

/** The interactive part of a listing page (VAREL Shop.tsx / Category.tsx below the hero): toolbar (filter
    trigger, count, sort), filter rail, active chips and the product grid. One island per page, `client:load`. */
export default function CatalogListing(props: CatalogListingProps) {
  return (
    <TextProvider locale={props.locale} dicts={props.dicts}>
      <Listing {...props} />
    </TextProvider>
  );
}

function Listing({mode, scope, initial, heading, intro, chips = [], shopHref = '/shop/'}: CatalogListingProps) {
  const t = useText('catalog');
  const {params, data} = useListingState({
    mode,
    scope,
    initialSearch: initial.search,
    initialList: initial.list,
    initialBase: initial.base,
    errorText: t('results.errorBody'),
  });

  // Counts outside this island (the category hero) follow the filtered total.
  const countText = data.total === undefined ? ' ' : t('pieces', {count: data.total});
  useEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-catalog-count]')) el.textContent = countText;
  }, [countText]);

  return mode === 'shop' ? (
    <ShopListing params={params} data={data} heading={heading} intro={intro} countText={countText} />
  ) : (
    <CategoryListing params={params} data={data} chips={chips} shopHref={shopHref} />
  );
}

interface PartProps {
  params: ListingState;
  data: ListingData;
}

function NoMatch({params}: {params: ListingState}) {
  const t = useText('catalog');
  return (
    <EmptyState
      title={t('results.noMatchTitle')}
      description={t('results.noMatchBody')}
      action={
        <Button variant="outline" onClick={params.clearAll}>
          {t('results.clearFilters')}
        </Button>
      }
    />
  );
}

/** VAREL Shop.tsx from the header down. */
function ShopListing({params, data, heading, intro, countText}: PartProps & {heading?: string; intro?: string; countText: string}) {
  const t = useText('catalog');
  const panel = {
    facets: data.base?.facets,
    counts: data.base?.counts,
    priceMax: data.base?.priceMax,
    params,
    loading: data.isLoading,
  };
  return (
    <>
      <header className="grid grid-cols-1 items-end gap-6 border-b border-hairline px-6 pt-8 pb-8 md:px-12 md:pb-10 lg:grid-cols-[1fr_auto] lg:gap-12">
        <div className="flex flex-col gap-4">
          <h1 className="m-0 font-display text-[40px] leading-[1.06] font-normal tracking-display md:text-[56px]">{heading}</h1>
          <p className="m-0 max-w-[52ch] text-[15px] leading-body text-text-secondary">{intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
          <FilterTrigger {...panel} total={data.total} triggerClassName="lg:hidden" />
          <span aria-live="polite" className="text-label-md tracking-label text-text-muted uppercase">
            {countText}
          </span>
          <SortSelect value={params.sort} onChange={params.setSort} className="w-full xs:w-[220px]" />
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-12 px-6 pt-8 pb-24 md:px-12 md:pt-10 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside aria-label={t('filters.label')} className="sticky top-24 hidden max-h-[calc(100vh-120px)] overflow-y-auto pr-1 lg:block">
          <FilterPanel {...panel} />
        </aside>

        <div className="flex min-w-0 flex-col gap-7">
          <ActiveFilterChips params={params} facets={data.base?.facets} />
          <ProductResults
            items={data.items}
            isLoading={data.isLoading}
            isError={data.isError}
            isFetching={data.isFetching}
            onRetry={data.retry}
            selectedColors={params.selected.color}
            onSelectColor={name => params.toggle('color', name)}
            empty={<NoMatch params={params} />}
          />
        </div>
      </div>
    </>
  );
}

const chipCls = (on: boolean) =>
  cn(
    'border px-4 py-[9px] text-label-sm tracking-label uppercase transition-hover',
    on
      ? 'border-strong bg-ink-900 text-ink-000 hover:bg-ink-900 hover:text-ink-000'
      : 'border-hairline bg-transparent text-ink-900 hover:border-strong hover:text-ink-900'
  );

const HIDE: FacetKey[] = ['category'];
const categoryMeta = (p: Product) => dotJoin(p.categoryLabel ?? p.category, p.material);

/** VAREL Category.tsx from the category chips row to the grid. */
function CategoryListing({params, data, chips, shopHref}: PartProps & {chips: CategoryChip[]; shopHref: string}) {
  const t = useText('catalog');
  // Category links keep the chosen sort; filters are reset (facets differ per category).
  const sortQuery = listingQueryString(params.sort === 'featured' ? {} : {sort: params.sort});
  const baseEmpty = data.base?.total === 0;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 border-b border-hairline px-6 py-6 md:px-12">
        <div className="flex flex-wrap gap-2">
          {chips.map(c => (
            <a key={c.path} href={c.path + sortQuery} aria-current={c.current ? 'page' : undefined} className={chipCls(c.current)}>
              {c.label}
            </a>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-6">
          <FilterTrigger
            facets={data.base?.facets}
            counts={data.base?.counts}
            priceMax={data.base?.priceMax}
            params={params}
            hide={HIDE}
            loading={data.isLoading}
            total={data.total}
          />
          <SortSelect variant="inline" value={params.sort} onChange={params.setSort} options={CATEGORY_SORTS} />
        </div>
      </div>

      <div className="flex flex-col gap-8 px-6 pt-10 pb-24 md:px-12">
        <ActiveFilterChips params={params} hide={HIDE} facets={data.base?.facets} />
        <ProductResults
          items={data.items}
          isLoading={data.isLoading}
          isError={data.isError}
          isFetching={data.isFetching}
          onRetry={data.retry}
          meta={categoryMeta}
          selectedColors={params.selected.color}
          skeletonCount={6}
          empty={
            baseEmpty ? (
              <EmptyState
                className="gap-3.5"
                title={t('category.emptyTitle')}
                description={t('category.emptyBody')}
                action={
                  <Button href={shopHref} variant="outline">
                    {t('category.allProducts')}
                  </Button>
                }
              />
            ) : (
              <NoMatch params={params} />
            )
          }
        />
      </div>
    </>
  );
}
