/*
 * SLOT: the bag drawer's content (lines, free-shipping progress, discounts, totals, checkout buttons).
 * // WP-09 implements
 *
 * The drawer frame (src/components/layout/BagDrawer.tsx, F2) renders this inside its sheet, under the title
 * "Your bag (n)". WP-09 replaces the BODY of this component (port of VAREL `layout/BagDrawer.tsx`: GET
 * /site-api/cart, line quantity/remove, discount rows) and keeps the export name and props. Report every cart
 * the server returns with `bag.applyCart(cart)` (src/lib/stores/bag.ts) so the header count follows; the
 * store also fires `varel:cart` (detail: the cart) after any add-to-bag elsewhere on the page.
 *
 * Until then it shows VAREL's empty state, or links to the bag and checkout when the bag has pieces.
 */
import {useBag} from '@/lib/stores/bag';
import {Button} from '@/components/varel/Button';
import {useText} from '@/components/varel/text';

export interface BagDrawerContentProps {
  /** Close the drawer (call it before following a link inside it). */
  onClose: () => void;
  /** Localized hrefs */
  links: {shop: string; cart: string; checkout: string};
}

export function BagDrawerContent({onClose, links}: BagDrawerContentProps) {
  const t = useText('layout');
  const {count} = useBag();

  if (count === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-8 pb-8 text-body-sm max-sm:px-6">
        <div className="flex flex-col items-start gap-4 pt-2">
          <h2 className="m-0 font-display text-display-5 font-normal">{t('bag.emptyTitle')}</h2>
          <p className="m-0 text-body-sm text-text-secondary">{t('bag.emptyBody')}</p>
          <Button href={links.shop} variant="outline" onClick={onClose} className="mt-2">
            {t('bag.continueShopping')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-8 pb-8 text-body-sm max-sm:px-6" />
      <div className="mt-auto flex flex-col gap-4 border-t border-hairline px-8 py-6 max-sm:px-6">
        <Button href={links.checkout} fullWidth onClick={onClose}>
          {t('bag.checkout')}
        </Button>
        <Button href={links.cart} variant="outline" fullWidth onClick={onClose}>
          {t('bag.viewBag')}
        </Button>
        <p className="m-0 text-center text-body-xs text-text-muted">{t('bag.taxesNote')}</p>
      </div>
    </>
  );
}
