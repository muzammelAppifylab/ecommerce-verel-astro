import {money, useText} from '@/components/varel';
import type {Facet} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {FACET_KEYS, type FacetKey} from './listing';
import type {ListingState} from './useListingState';

export interface ActiveFilterChipsProps {
  params: ListingState;
  /** Facet keys not shown as chips */
  hide?: FacetKey[];
  /** Facets of the base listing: their `labels` give each value's display text */
  facets?: Facet[];
  className?: string;
}

const chipCls =
  'flex items-center gap-2.5 border border-strong bg-transparent px-3.5 py-2 text-label-sm tracking-label uppercase transition-hover hover:bg-ink-900 hover:text-text-inverse';

/** Removable chips for every active filter value ("Stone ×"). Renders nothing when no filter is on. */
export function ActiveFilterChips({params, hide = [], facets, className}: ActiveFilterChipsProps) {
  const t = useText('catalog');
  const chips: {key: string; label: string; onRemove: () => void}[] = [];
  for (const k of FACET_KEYS) {
    if (hide.includes(k)) continue;
    const labels = facets?.find(f => f.key === k)?.labels;
    for (const v of params.selected[k]) chips.push({key: `${k}:${v}`, label: labels?.[v] ?? v, onRemove: () => params.toggle(k, v)});
  }
  if (params.maxPrice !== undefined) {
    chips.push({key: 'price', label: t('filters.upTo', {price: money(params.maxPrice)}), onRemove: () => params.setMaxPrice(undefined)});
  }
  if (!chips.length) return null;

  return (
    <div className={cn('flex flex-wrap gap-2', className)} aria-label={t('filters.active')}>
      {chips.map(c => (
        <button key={c.key} type="button" onClick={c.onRemove} aria-label={t('filters.remove', {label: c.label})} className={chipCls}>
          {c.label} <span aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  );
}
