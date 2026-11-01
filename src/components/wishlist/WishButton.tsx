/* The standalone heart, for places that are not a ProductTile: the product page buy column (WP-03) and the
   home page featured piece / product cards (WP-01). VAREL BuyColumn.tsx, FeaturedPiece.tsx, HomeProductCard.tsx.
   Usable two ways:
     - inside an island that already has a <TextProvider> with the `product` catalog: <WishButton productId name />
     - as its own island from an .astro page: <WishButtonIsland client:visible productId name locale dicts />
       with `dicts = dictsFor(locale, {product: ['tile'], common: ['error']})` (src/components/layout/dictionaries.ts). */
import {useEffect} from 'react';

import {Icon} from '@/components/varel/Icon';
import {type Dicts, TextProvider, useText} from '@/components/varel/text';
import {notifyError} from '@/components/varel/Toast';
import {bag, useWished} from '@/lib/stores/bag';
import {cn} from '@/lib/utils';

export interface WishButtonProps {
  productId: string;
  /** Product name, for the accessible label ("Add Forma Overshirt to wishlist") */
  name: string;
  /** tile: 34px square overlay on a photo (HomeProductCard); inline: bare icon (BuyColumn, FeaturedPiece) */
  variant?: 'tile' | 'inline';
  /** Icon size in px (default 17 tile, 20 inline) */
  size?: number;
  /** Use the short labels ("Add to wishlist") as the accessible name, as the product page does */
  shortLabel?: boolean;
  className?: string;
}

export function WishButton({productId, name, variant = 'inline', size, shortLabel = false, className}: WishButtonProps) {
  const t = useText('product');
  const common = useText('common');
  const wished = useWished(productId);

  // Hearts on server-rendered pages need the saved ids once per visit (no-op after the first call).
  useEffect(() => {
    void bag.sync();
  }, []);

  const toggle = () => {
    bag
      .toggleWishlist(productId, !wished)
      .catch((error: unknown) => notifyError(error instanceof Error ? error.message : common('error')));
  };

  const short = wished ? t('tile.removeFromWishlist') : t('tile.addToWishlist');
  const long = wished ? t('tile.removeNameFromWishlist', {name}) : t('tile.addNameToWishlist', {name});

  return (
    <button
      type="button"
      onClick={toggle}
      title={short}
      aria-label={shortLabel ? short : long}
      aria-pressed={wished}
      data-wish={wished ? 'on' : 'off'}
      className={cn(
        variant === 'tile'
          ? cn(
              'flex size-[34px] items-center justify-center border border-hairline bg-surface-page transition-hover',
              wished ? 'text-signal-critical' : 'text-ink-400 hover:text-ink-900'
            )
          : cn(
              'inline-flex items-center justify-center border-0 bg-transparent p-0 transition-hover',
              wished ? 'text-signal-critical' : 'text-ink-900 hover:text-ink-500'
            ),
        className
      )}>
      <Icon name="heart" size={size ?? (variant === 'tile' ? 17 : 20)} />
    </button>
  );
}

/** WishButton as its own island (an .astro page): brings its words. */
export function WishButtonIsland({locale, dicts, ...props}: WishButtonProps & {locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <WishButton {...props} />
    </TextProvider>
  );
}

export default WishButtonIsland;
