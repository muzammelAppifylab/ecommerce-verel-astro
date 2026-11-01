import {useEffect, useRef, useState} from 'react';

import {bag, useWished} from '@/lib/stores/bag';

import {localizeHref} from './href';
import {ProductTile, type ProductTileProps, promotionNote} from './ProductTile';
import {badgeTone, firstAvailableVariant, type ProductLike, productMeta, productPrice} from './support';
import {useLocale, useText} from './text';
import {notifyError} from './Toast';

export interface ProductGridItemProps extends Partial<Omit<ProductTileProps, 'name' | 'href' | 'photo' | 'price'>> {
  product: ProductLike;
  /** Product page URL; default `/product/<id>/` in the page language */
  href?: string;
  /** Hide the quick-add bar */
  noAdd?: boolean;
  /** Hide the heart */
  noWish?: boolean;
}

/** ProductTile wired to the API through the bag store: wishlist toggle (optimistic) + quick add (first available
 *  variant, "Added to bag" for 1.6s, opens the bag drawer). Any ProductTile prop can be overridden. */
export function ProductGridItem({product: p, href, noAdd, noWish, ...overrides}: ProductGridItemProps) {
  const t = useText('product');
  const common = useText('common');
  const locale = useLocale();
  const wished = useWished(p.id);
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const {price, compareAt} = productPrice(p, common('free'));
  const soldOut = p.stock === 'out';

  const label = soldOut
    ? t('tile.soldOut')
    : p.type === 'digital'
      ? t('tile.download')
      : added
        ? t('tile.addedToBag')
        : t('tile.addToBag');

  const onAdd = () => {
    if (soldOut || adding) return;
    const v = firstAvailableVariant(p, overrides.selectedColor);
    setAdding(true);
    bag
      .addToBag({productId: p.id, color: v?.color ?? null, size: v?.size ?? null, qty: 1})
      .then(() => {
        setAdded(true);
        timer.current = window.setTimeout(() => setAdded(false), 1600);
      })
      .catch((error: unknown) => notifyError(error instanceof Error ? error.message : common('error')))
      .finally(() => setAdding(false));
  };

  const onWish = () => {
    bag.toggleWishlist(p.id, !wished).catch((error: unknown) =>
      notifyError(error instanceof Error ? error.message : common('error'))
    );
  };

  return (
    <ProductTile
      name={p.name}
      href={href ?? localizeHref(locale, `/product/${encodeURIComponent(p.id)}/`)}
      photo={p.image}
      alt={p.alt}
      price={price}
      compareAt={compareAt}
      onSale={p.onSale}
      meta={productMeta(p)}
      badge={p.badge}
      badgeTone={badgeTone(p.badge, p)}
      promotion={promotionNote(p.promotion, t)}
      rating={p.rating}
      swatches={p.swatches}
      stock={p.stock}
      stockLabel={p.stockLabel}
      wished={wished}
      onWish={noWish ? undefined : onWish}
      onAdd={noAdd ? undefined : onAdd}
      addLabel={label}
      addDisabled={soldOut || adding}
      {...overrides}
    />
  );
}
