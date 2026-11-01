import {useState} from 'react';

import {localizeHref} from '@/components/varel/href';
import {ProductTile} from '@/components/varel/ProductTile';
import {badgeTone, dotJoin, firstAvailableVariant, money, priceText} from '@/components/varel/support';
import {useLocale, useText} from '@/components/varel/text';
import {notifyError} from '@/components/varel/Toast';
import {bag} from '@/lib/stores/bag';
import type {Product} from '@/lib/types/catalog';

import {useFlash} from './use-flash';

/** One saved piece (VAREL Wishlist.tsx `WishTile`): the tile with the heart as "remove" and a quick add that
 *  keeps the piece on the wishlist and leaves the bag drawer closed. */
export function WishTile({product: p, onRemove}: {product: Product; onRemove: () => void}) {
  const t = useText('wishlist');
  const common = useText('common');
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [added, flash] = useFlash(1600);
  const soldOut = p.stock === 'out';

  const onAdd = () => {
    if (soldOut || adding) return;
    const v = firstAvailableVariant(p);
    setAdding(true);
    bag
      .addToBag({productId: p.id, color: v?.color ?? null, size: v?.size ?? null, qty: 1}, {open: false})
      .then(flash)
      .catch((error: unknown) => notifyError(error instanceof Error ? error.message : common('error')))
      .finally(() => setAdding(false));
  };

  return (
    <ProductTile
      name={p.name}
      href={localizeHref(locale, `/product/${encodeURIComponent(p.id)}/`)}
      photo={p.image}
      alt={p.alt}
      price={priceText(p.price, common('free'))}
      compareAt={p.compareAt ? money(p.compareAt) : null}
      onSale={p.onSale}
      meta={dotJoin(p.deptLabel ?? p.dept, p.categoryLabel ?? p.category)}
      badge={p.badge}
      badgeTone={badgeTone(p.badge, p)}
      swatches={p.swatches}
      stock={p.stock}
      stockLabel={p.stockLabel}
      wished
      onWish={onRemove}
      wishLabel={t('removeItem', {name: p.name})}
      onAdd={onAdd}
      addDisabled={soldOut || adding}
      addLabel={soldOut ? t('notifyMe') : adding ? t('adding') : added ? t('added') : t('addToBag')}
      nameSize={21}
      sizes="(min-width: 1024px) 23vw, 50vw"
    />
  );
}
