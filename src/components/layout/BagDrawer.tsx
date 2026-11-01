import {BagDrawerContent} from '@/components/cart/BagDrawerContent';
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {useText} from '@/components/varel/text';
import {useBag} from '@/lib/stores/bag';
import {ui} from '@/lib/stores/ui';

export interface BagDrawerProps {
  links: {shop: string; cart: string; checkout: string};
}

/** Right-edge bag drawer FRAME (440px, slides in over 400ms), ported from VAREL `layout/BagDrawer.tsx`.
 *  Opened with `ui.openBag()` / `bag.openBag()`: the header's Bag button and, automatically, after add-to-bag.
 *  The content (lines, totals, checkout) is WP-09's slot: src/components/cart/BagDrawerContent.tsx. */
export function BagDrawer({links}: BagDrawerProps) {
  const t = useText('layout');
  const common = useText('common');
  const {open, count} = useBag();
  return (
    <Sheet open={open} onOpenChange={o => !o && ui.closeBag()}>
      <SheetContent side="right" closeLabel={common('close')} className="w-full max-w-[440px]! gap-0">
        <SheetHeader className="pr-16">
          <SheetTitle>{t('bag.title', {count})}</SheetTitle>
          <SheetDescription className="sr-only">{t('bag.description')}</SheetDescription>
        </SheetHeader>
        <BagDrawerContent onClose={ui.closeBag} links={links} />
      </SheetContent>
    </Sheet>
  );
}
