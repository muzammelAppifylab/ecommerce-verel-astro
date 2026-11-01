import {Checkbox, Skeleton, useText} from '@/components/varel';
import type {Facet, FacetCounts} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {type FacetKey, priceCeiling} from './listing';
import {PriceSlider} from './PriceSlider';
import type {ListingState} from './useListingState';

export interface FilterPanelProps {
  /** Facets from the base (unfiltered) listing */
  facets: Facet[] | undefined;
  /** Per-option counts over the base listing (server-side, replaces VAREL's `facetCount(baseItems)`) */
  counts: FacetCounts | undefined;
  priceMax: number | undefined;
  params: ListingState;
  /** Facet keys not offered here (e.g. category on department pages) */
  hide?: FacetKey[];
  /** Hide the "Filter / Clear" header row (the Sheet has its own) */
  noHeader?: boolean;
  loading?: boolean;
  className?: string;
}

/** Filter rail from the Shop prototype: facet checkboxes with counts + price slider (port of VAREL FilterPanel). */
export function FilterPanel({facets, counts, priceMax, params, hide = [], noHeader, loading, className}: FilterPanelProps) {
  const t = useText('catalog');
  const shown = (facets ?? []).filter(f => !hide.includes(f.key));

  return (
    <div className={cn('flex flex-col gap-7', className)}>
      {!noHeader && (
        <div className="flex items-center justify-between">
          <span className="text-label-sm tracking-label uppercase">{t('filters.title')}</span>
          <button
            type="button"
            onClick={params.clearAll}
            className="border-0 bg-transparent p-0 text-label-sm tracking-label text-text-muted uppercase transition-hover hover:text-text-primary">
            {t('filters.clear')}
          </button>
        </div>
      )}

      {loading && !facets
        ? Array.from({length: 4}, (_, i) => (
            <div key={i} className="flex flex-col gap-3 border-t border-hairline pt-5" aria-hidden="true">
              <Skeleton className="mb-1 h-3 w-16" />
              {Array.from({length: 4}, (_, j) => (
                <Skeleton key={j} className="h-4 w-3/4" />
              ))}
            </div>
          ))
        : shown.map(f => (
            <fieldset key={f.key} className="m-0 flex flex-col gap-3 border-0 border-t border-hairline px-0 pt-5 pb-0">
              <legend className="float-left w-full p-0 text-label-sm tracking-label text-text-muted uppercase">{f.label}</legend>
              {f.values.map(v => {
                const on = params.selected[f.key].includes(v);
                return (
                  <div key={v} className={cn('flex items-center gap-3', on ? 'text-ink-900' : 'text-ink-500')}>
                    <Checkbox checked={on} label={f.labels?.[v] ?? v} onChange={() => params.toggle(f.key, v)} />
                    <span className="ml-auto text-label-md text-text-muted">{counts?.[f.key]?.[v] ?? 0}</span>
                  </div>
                );
              })}
            </fieldset>
          ))}

      {priceMax !== undefined && priceMax > 0 && (
        <PriceSlider max={priceCeiling(priceMax)} value={params.maxPrice} onChange={params.setMaxPrice} />
      )}
    </div>
  );
}
