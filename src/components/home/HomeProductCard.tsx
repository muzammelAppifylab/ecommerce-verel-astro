/* Home product tile (port of VAREL src/pages/home/HomeProductCard.tsx): 20px name, uppercase subtitle, 15px
   outlined swatches, a "Quick add" bar and a heart over the image. Rendered inside the New-in and Featured
   islands (`client:visible`), so the first paint is server HTML and the buttons work once hydrated.
   Bag and wishlist go through the shared store (src/lib/stores/bag.ts): the header count and the bag drawer
   follow. Swatch colours are painted through the CSSOM (`useElementStyle`): the CSP forbids style="". */
import {useEffect, useRef, useState} from 'react';

import {Badge, Icon, Img, notifyError, promotionNote} from '@/components/varel';
import {useElementStyle} from '@/components/varel/element-style';
import {useLocale, useText} from '@/components/varel/text';
import {dotJoin} from '@/lib/format';
import {productLink} from '@/lib/links';
import {badgeTone, firstAvailableVariant, STOCK_TEXT} from '@/lib/product';
import {bag, useWished} from '@/lib/stores/bag';
import type {Product, Swatch as SwatchData} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {priceOf} from './island';

/** A colour dot whose fill is the API's hex. */
export function Swatch({
  swatch,
  on,
  onPick,
  className,
}: {
  swatch: SwatchData;
  on: boolean;
  onPick: () => void;
  className: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useElementStyle(ref, {background: swatch.hex});
  return (
    <button
      ref={ref}
      type="button"
      title={swatch.label ?? swatch.name}
      aria-label={swatch.label ?? swatch.name}
      aria-pressed={on}
      onClick={onPick}
      className={cn('bg-ink-100', className, on ? 'outline outline-1 outline-strong' : 'outline-none')}
    />
  );
}

/** The heart: optimistic, rolls back (with a toast) when the server refuses. */
export function useWishToggle(p: Pick<Product, 'id'>) {
  const wished = useWished(p.id);
  const toggle = () => {
    bag.toggleWishlist(p.id, !wished).catch((e: unknown) => notifyError(e instanceof Error ? e.message : String(e)));
  };
  return {wished, toggle};
}

/** "Added" for 1.6 s after a successful add (VAREL). */
export function useAddedFlash() {
  const [added, setAdded] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = () => {
    setAdded(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAdded(false), 1600);
  };
  return {added, flash};
}

export function HomeProductCard({product: p, currency}: {product: Product; currency?: string}) {
  const t = useText('product');
  const locale = useLocale();
  const {wished, toggle} = useWishToggle(p);
  const {added, flash} = useAddedFlash();
  const [color, setColor] = useState<string | null>(p.swatches[0]?.name ?? null);
  const [pending, setPending] = useState(false);

  const soldOut = p.stock === 'out';
  const {price, compareAt} = priceOf(p, currency, locale);
  const to = productLink(p.id, locale);
  const label = soldOut ? t('tile.notifyMe') : added ? t('tile.added') : t('tile.quickAdd');
  const promo = promotionNote(p.promotion, t);

  const onAdd = async () => {
    if (soldOut) {
      window.location.assign(to);
      return;
    }
    if (pending) return;
    const v = firstAvailableVariant(p, color);
    setPending(true);
    try {
      await bag.addToBag({productId: p.id, color: v?.color ?? null, size: v?.size ?? null, qty: 1});
      flash();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <article data-card="true" className="group flex min-w-0 flex-col gap-3.5">
      <div className="relative aspect-[3/4] overflow-hidden bg-ink-100">
        <a href={to} tabIndex={-1} aria-hidden="true" className="absolute inset-0 block border-0">
          <Img photo={p.image} alt={p.alt} ratio="fill" width={900} sizes="(min-width: 1024px) 24vw, 50vw" />
        </a>
        {p.badge && (
          <Badge
            tone="ink"
            className={cn(
              'pointer-events-none absolute top-0 left-0 h-auto px-2.5 py-1.5 leading-[1.35]',
              badgeTone(p.badge, p) === 'quiet' && 'bg-ink-400'
            )}>
            {p.badge}
          </Badge>
        )}
        <button
          type="button"
          onClick={toggle}
          title={wished ? t('tile.removeFromWishlist') : t('tile.addToWishlist')}
          aria-label={wished ? t('tile.removeNameFromWishlist', {name: p.name}) : t('tile.addNameToWishlist', {name: p.name})}
          aria-pressed={wished}
          data-wish={wished ? 'on' : 'off'}
          className={cn(
            'absolute top-2.5 right-2.5 flex size-[34px] items-center justify-center rounded-none border border-hairline bg-surface-page leading-none transition-hover',
            wished ? 'text-signal-critical' : 'text-ink-400 hover:text-ink-900'
          )}>
          <Icon name="heart" size={17} />
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={soldOut ? t('tile.soldOutDetails', {name: p.name}) : t('tile.addNameToBag', {name: p.name})}
          className="absolute inset-x-0 bottom-0 h-11 rounded-none border-0 bg-ink-900 font-sans text-label-sm tracking-label text-text-inverse uppercase transition-[transform,background-color] duration-240 ease-out hover:bg-ink-700 active:opacity-48 disabled:cursor-not-allowed disabled:opacity-60 can-hover:translate-y-full can-hover:group-hover:translate-y-0 can-hover:group-focus-within:translate-y-0">
          {label}
        </button>
      </div>
      <div className="flex flex-col gap-[7px]">
        <div className="flex items-baseline justify-between gap-3">
          <a
            href={to}
            data-name="true"
            className="min-w-0 font-display text-[20px] leading-display tracking-display text-text-primary hover:text-text-primary">
            {p.name}
          </a>
          <span className="flex items-baseline gap-2 whitespace-nowrap">
            {compareAt && <span className="text-body-xs text-text-muted line-through">{compareAt}</span>}
            <span className={cn('text-body-xs', compareAt ? 'text-signal-critical' : 'text-ink-900')}>{price}</span>
          </span>
        </div>
        <span className="text-label-sm tracking-label text-text-muted uppercase">
          {dotJoin(p.categoryLabel ?? p.category, p.deptLabel ?? p.dept)}
        </span>
        {promo && <span className="text-label-sm tracking-label text-signal-positive uppercase">{promo}</span>}
        <div className="mt-1 flex items-center gap-2">
          {p.swatches.map(s => (
            <Swatch
              key={s.name}
              swatch={s}
              on={color === s.name}
              onPick={() => setColor(s.name)}
              className="size-[15px] shrink-0 rounded-full border border-hairline p-0 outline-offset-2"
            />
          ))}
          <span className={cn('ml-auto text-label-sm tracking-label uppercase', STOCK_TEXT[p.stock])}>{p.stockLabel}</span>
        </div>
      </div>
    </article>
  );
}
