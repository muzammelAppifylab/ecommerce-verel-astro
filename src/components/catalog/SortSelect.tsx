import {useId} from 'react';

import {Icon, Select, useText} from '@/components/varel';
import {cn} from '@/lib/utils';

import {type ListingSort, SORT_OPTIONS} from './listing';

export interface SortSelectProps {
  value: ListingSort;
  onChange: (sort: ListingSort) => void;
  /** field = design-system Select with a "Sort" label above (Shop header);
   *  inline = "SORT" label beside an underlined select (Category toolbar) */
  variant?: 'field' | 'inline';
  /** Restrict the options (Category shows no "Newest") */
  options?: ListingSort[];
  className?: string;
}

/** Port of VAREL SortSelect. A sort from the URL outside `options` (`?sort=newest` on a category page) is still
    listed while it is the active one, so the select never shows a value it does not have. */
export function SortSelect({value, onChange, variant = 'field', options, className}: SortSelectProps) {
  const id = useId();
  const t = useText('catalog');
  const opts = (options ? SORT_OPTIONS.filter(o => options.includes(o) || o === value) : SORT_OPTIONS).map(v => ({
    value: v,
    label: t(`sort.${v}`),
  }));

  if (variant === 'field') {
    return (
      <Select
        label={t('sort.label')}
        value={value}
        options={opts}
        onChange={e => onChange(e.target.value as ListingSort)}
        className={cn('w-[220px]', className)}
      />
    );
  }

  return (
    <label htmlFor={id} className={cn('flex min-w-0 items-center gap-2.5 text-label-sm tracking-label text-text-muted uppercase', className)}>
      {t('sort.label')}
      <span className="relative inline-flex min-w-0 items-center">
        <select
          id={id}
          value={value}
          onChange={e => onChange(e.target.value as ListingSort)}
          aria-label={t('sort.aria')}
          className="min-w-0 max-w-[44vw] cursor-pointer appearance-none truncate rounded-none border-0 border-b border-strong bg-transparent py-2 pr-6 pl-1 text-[13px] tracking-normal text-text-primary normal-case outline-none sm:max-w-none">
          {opts.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-0.5 text-text-primary">
          <Icon name="chevron-down" size={14} />
        </span>
      </span>
    </label>
  );
}
