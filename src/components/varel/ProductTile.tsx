import {cn} from '@/lib/utils';

import {Badge, type BadgeTone} from './Badge';
import {ColorSwatch} from './ColorSwatch';
import {Icon} from './Icon';
import {Img} from './Img';
import {Price} from './Price';
import {Stars} from './Stars';
import {type Photo, STOCK_TEXT, type StockState, type Swatch} from './support';
import {type Translate, useText} from './text';

export interface ProductTileProps {
  name: string;
  /** Product page URL (already localized), e.g. "/product/forma-overshirt/" */
  href: string;
  photo?: Photo | null;
  alt?: string;
  /** Formatted price ("$148" or "Free") */
  price: string;
  compareAt?: string | null;
  /** Price turns signal-critical when on sale */
  onSale?: boolean;
  /** "Women · Knitwear · Merino wool" */
  meta?: string;
  badge?: string | null;
  badgeTone?: BadgeTone;
  /** Quiet automatic-promotion note under the meta, e.g. "15% off in your bag" (never replaces the badge) */
  promotion?: string | null;
  /** Approved-review average; a quiet line shows when count > 0 */
  rating?: {avg: number; count: number} | null;
  swatches?: Swatch[];
  selectedColor?: string | null;
  onSelectColor?: (name: string) => void;
  stock?: StockState;
  stockLabel?: string;
  /** Heart button (hidden when onWish is not given) */
  wished?: boolean;
  onWish?: () => void;
  wishLabel?: string;
  /** Quick-add bar along the image bottom (hidden when onAdd is not given) */
  onAdd?: () => void;
  addLabel?: string;
  addDisabled?: boolean;
  /** compact = Search / 404 tile: no overlays, no swatches, 20px name */
  variant?: 'full' | 'compact';
  /** Name size in px (prototype: 22 Shop/Category, 21 Wishlist, 20 Home/Search) */
  nameSize?: 20 | 21 | 22;
  /** `sizes` hint for the image */
  sizes?: string;
  /** Load the image eagerly with high priority (the first tiles of a listing: the likely LCP image) */
  priority?: boolean;
  className?: string;
}

const NAME_SIZE = {20: 'text-[20px]', 21: 'text-[21px]', 22: 'text-[22px]'} as const;

/** Customer-facing note for `Product.promotion`: "15% off knitwear" → "15% off knitwear in your bag".
 *  `t` is the `product` namespace translator (useText('product')). */
export function promotionNote(promotion: {label: string} | null | undefined, t: Translate): string | null {
  const label = promotion?.label?.trim();
  if (!label) return null;
  const bag = t('tile.bagWord').toLowerCase();
  const mentionsBag = /\bbag\b/i.test(label) || new RegExp(`(^|[^\\p{L}])${bag}([^\\p{L}]|$)`, 'iu').test(label);
  return mentionsBag ? label : t('tile.promotionInBag', {label});
}

/** The storefront product tile from the Shop / Category / Wishlist prototypes. */
export function ProductTile({
  name,
  href,
  photo,
  alt,
  price,
  compareAt,
  onSale,
  meta,
  badge,
  badgeTone = 'ink',
  promotion,
  rating,
  swatches = [],
  selectedColor,
  onSelectColor,
  stock,
  stockLabel,
  wished = false,
  onWish,
  wishLabel,
  onAdd,
  addLabel,
  addDisabled = false,
  variant = 'full',
  nameSize,
  sizes = '(min-width: 1024px) 30vw, 50vw',
  priority = false,
  className,
}: ProductTileProps) {
  const t = useText('product');
  const compact = variant === 'compact';
  const stockCls = stock ? STOCK_TEXT[stock] : 'text-text-muted';
  return (
    <article data-card="true" className={cn('group flex min-w-0 flex-col', compact ? 'gap-3' : 'gap-3.5', className)}>
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-chalk">
        <a href={href} aria-label={name} tabIndex={compact ? undefined : -1} className="absolute inset-0 block border-0">
          <Img photo={photo} alt={alt ?? name} ratio="fill" width={800} sizes={sizes} priority={priority} />
        </a>
        {!compact && badge && (
          <span className="absolute top-0 left-0">
            <Badge tone={badgeTone}>{badge}</Badge>
          </span>
        )}
        {!compact && onWish && (
          <button
            type="button"
            onClick={onWish}
            title={wished ? t('tile.removeFromWishlist') : t('tile.addToWishlist')}
            aria-label={wishLabel ?? (wished ? t('tile.removeNameFromWishlist', {name}) : t('tile.addNameToWishlist', {name}))}
            aria-pressed={wished}
            data-wish={wished ? 'on' : 'off'}
            className={cn(
              'absolute top-2.5 right-2.5 flex size-[34px] items-center justify-center border border-hairline bg-surface-page transition-hover',
              wished ? 'text-signal-critical' : 'text-ink-400 hover:text-ink-900'
            )}>
            <Icon name="heart" size={17} />
          </button>
        )}
        {!compact && onAdd && (
          <button
            type="button"
            onClick={onAdd}
            disabled={addDisabled}
            className="absolute inset-x-0 bottom-0 h-11 border-0 bg-ink-900 font-sans text-label-sm tracking-label text-text-inverse uppercase transition-[transform,background-color] duration-240 ease-out hover:bg-ink-700 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-300 can-hover:translate-y-full can-hover:group-hover:translate-y-0 can-hover:group-focus-within:translate-y-0">
            {addLabel ?? t('tile.addToBag')}
          </button>
        )}
      </div>
      <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-2')}>
        <div className={cn('flex items-baseline justify-between', compact ? 'gap-3' : 'gap-4')}>
          <a
            href={href}
            data-name="true"
            className={cn(
              'min-w-0 font-display leading-display text-text-primary hover:text-text-primary',
              NAME_SIZE[nameSize ?? (compact ? 20 : 22)]
            )}>
            {name}
          </a>
          <span className={cn('whitespace-nowrap', onSale ? 'text-signal-critical' : 'text-ink-900')}>
            {compact ? <span className="text-body-sm">{price}</span> : <Price amount={price} compareAt={compareAt} />}
          </span>
        </div>
        {meta && <span className={cn('text-text-muted', compact ? 'text-label-md' : 'text-body-xs')}>{meta}</span>}
        {rating && rating.count > 0 && (
          <span className="flex items-center gap-1.5 text-label-md text-text-muted tabular-nums">
            <Stars value={rating.avg} size={10} label={t('tile.rated', {avg: rating.avg.toFixed(1)})} />
            {rating.avg.toFixed(1)} ({rating.count})
          </span>
        )}
        {promotion && <span className="text-label-sm tracking-label text-signal-positive uppercase">{promotion}</span>}
        {compact
          ? stockLabel && <span className={cn('text-label-sm tracking-label uppercase', stockCls)}>{stockLabel}</span>
          : (swatches.length > 0 || stockLabel) && (
              <div className="mt-1 flex items-center gap-2">
                {swatches.map(w => (
                  <ColorSwatch
                    key={w.name}
                    color={w.hex}
                    label={w.label ?? w.name}
                    size={13}
                    selected={selectedColor === w.name}
                    onClick={onSelectColor ? () => onSelectColor(w.name) : undefined}
                  />
                ))}
                {stockLabel && <span className={cn('ml-auto text-label-sm tracking-label uppercase', stockCls)}>{stockLabel}</span>}
              </div>
            )}
      </div>
    </article>
  );
}
