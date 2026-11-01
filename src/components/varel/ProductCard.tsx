import {cn} from '@/lib/utils';

import {Badge} from './Badge';
import {ColorSwatch} from './ColorSwatch';
import {ProductMedia} from './ProductMedia';
import type {Photo} from './support';

export interface ProductCardProps {
  name: string;
  category?: string;
  /** Formatted price string, e.g. "$148" */
  price?: string;
  /** Colourway names: Black | Stone | Olive | Navy */
  colors?: string[];
  /** Single merchandising flag, e.g. "New" */
  badge?: string | null;
  /** Quiet automatic-promotion note, e.g. "15% off in your bag" */
  promotion?: string | null;
  tone?: 'Black' | 'Stone' | 'Olive' | 'Navy';
  src?: string;
  onClick?: () => void;
  /** Extensions */
  /** Product page URL (already localized), e.g. "/product/forma-overshirt/": renders the card as a link */
  href?: string;
  photo?: Photo | null;
  alt?: string;
  className?: string;
}

/** Design-system product tile: media, category, name, price, colourways.
 *  Image scales 2.8% on hover; the name underlines. For the full shop tile (wishlist + quick add) use ProductTile. */
export function ProductCard({
  name,
  category,
  price,
  colors = [],
  badge,
  promotion,
  tone = 'Stone',
  src,
  onClick,
  href,
  photo,
  alt,
  className,
}: ProductCardProps) {
  const body = (
    <>
      <div className="relative overflow-hidden">
        <div data-media="true">
          <ProductMedia tone={tone} src={src} photo={photo} alt={alt ?? name} caption={name} width={700} />
        </div>
        {badge && (
          <div className="absolute top-3 left-3">
            <Badge tone="ink">{badge}</Badge>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 pt-4">
        {category && <span className="varel-label text-label-sm text-text-muted">{category}</span>}
        <div className="flex justify-between gap-4 text-body-sm">
          <span data-name="true">{name}</span>
          {price && <span className="whitespace-nowrap">{price}</span>}
        </div>
        {promotion && <span className="text-label-sm tracking-label text-signal-positive uppercase">{promotion}</span>}
        {colors.length > 0 && (
          <div className="mt-2 flex gap-2">
            {colors.map(c => (
              <ColorSwatch key={c} color={c} size={12} />
            ))}
          </div>
        )}
      </div>
    </>
  );
  const cls = cn('block min-w-0 cursor-pointer border-0 text-text-primary hover:text-text-primary', className);
  if (href) {
    return (
      <a href={href} data-card="true" onClick={onClick} className={cls}>
        {body}
      </a>
    );
  }
  return (
    <article data-card="true" onClick={onClick} className={cls}>
      {body}
    </article>
  );
}
