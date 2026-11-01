import {Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle} from '@/components/ui/sheet';
import {Button, IconButton, useText} from '@/components/varel';

import {FilterPanel, type FilterPanelProps} from './FilterPanel';

export interface FilterSheetProps extends Omit<FilterPanelProps, 'noHeader' | 'className'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Result count for the "Show n pieces" footer button */
  total: number | undefined;
}

/** The filter drawer: FilterPanel in a left-side sheet (port of VAREL FilterSheet). Loaded on the first click of
    its trigger (FilterTrigger), so the dialog code stays out of the page's first JavaScript. */
export default function FilterSheet({open, onOpenChange, total, ...panel}: FilterSheetProps) {
  const t = useText('catalog');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[min(380px,90vw)] gap-0 border-hairline bg-surface-page p-0 text-body-sm text-text-primary sm:max-w-none">
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-hairline px-6">
          <SheetTitle className="text-label-sm tracking-label text-text-primary uppercase">{t('filters.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('filters.description')}</SheetDescription>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={panel.params.clearAll}
              className="border-0 bg-transparent p-0 text-label-sm tracking-label text-text-muted uppercase transition-hover hover:text-text-primary">
              {t('filters.clear')}
            </button>
            <SheetClose asChild>
              <IconButton name="x" label={t('filters.close')} size={36} />
            </SheetClose>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <FilterPanel {...panel} noHeader />
        </div>
        <div className="shrink-0 border-t border-hairline px-6 py-5">
          <Button fullWidth onClick={() => onOpenChange(false)}>
            {total === undefined ? t('filters.showResults') : t('filters.show', {count: total})}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
