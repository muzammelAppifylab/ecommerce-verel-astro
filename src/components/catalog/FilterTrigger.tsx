import {lazy, Suspense, useState} from 'react';

import {Icon, useText} from '@/components/varel';
import {cn} from '@/lib/utils';

import type {FilterSheetProps} from './FilterSheet';

const FilterSheet = lazy(() => import('./FilterSheet'));

export interface FilterTriggerProps extends Omit<FilterSheetProps, 'open' | 'onOpenChange'> {
  /** Classes for the trigger button (e.g. `lg:hidden` on Shop) */
  triggerClassName?: string;
}

/** "Filter (n)" button that opens the filter sheet (VAREL FilterSheet's trigger). The sheet's code is fetched on
    the first click, then stays mounted so it opens and closes with its animation. */
export function FilterTrigger({triggerClassName, ...sheet}: FilterTriggerProps) {
  const t = useText('catalog');
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const n = sheet.params.activeCount;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        className={cn(
          'flex items-center gap-2.5 border border-hairline bg-transparent px-4 py-[9px] text-label-sm tracking-label uppercase transition-hover hover:border-strong',
          triggerClassName
        )}>
        <Icon name="sliders-horizontal" size={14} />
        {n > 0 ? t('filters.titleCount', {count: n}) : t('filters.title')}
      </button>
      {mounted && (
        <Suspense fallback={null}>
          <FilterSheet {...sheet} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
