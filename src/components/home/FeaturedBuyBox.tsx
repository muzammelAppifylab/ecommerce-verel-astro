/* The inline buy box of the "Featured piece" block (VAREL src/pages/home/FeaturedPiece.tsx `BuyBox`). An island
   (`client:visible`) inside FeaturedPiece.astro, which renders the chalk frame, the photos and the eyebrow on
   the server and passes the product read there (`/products/atelier-wool-coat`). */
import {useState} from 'react';

import {Button, Icon, notifyError} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {money} from '@/lib/format';
import {productLink} from '@/lib/links';
import {soldOutSizes, variantOf} from '@/lib/product';
import {bag} from '@/lib/stores/bag';
import type {Product} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {Swatch, useAddedFlash, useWishToggle} from './HomeProductCard';
import {type HomeProps, HomeText} from './island';
import {initialSize, stockFor} from './sections';

function BuyBox({product: p, currency}: {product: Product; currency?: string}) {
  const t = useText('home');
  const tp = useText('product');
  const locale = useLocale();
  const {wished, toggle} = useWishToggle(p);
  const {added, flash} = useAddedFlash();
  const [color, setColor] = useState<string | null>(p.swatches[0]?.name ?? null);
  const [size, setSize] = useState<string | null>(() => initialSize(p));
  const [pending, setPending] = useState(false);

  const soldOut = soldOutSizes(p, color);
  const variant = variantOf(p, color, size);
  const stock = stockFor(variant ? variant.inventory : 0, t);
  const unavailable = !variant || (variant.inventory !== null && variant.inventory <= 0);
  const to = productLink(p.id, locale);

  const onAdd = async () => {
    if (unavailable || pending) return;
    setPending(true);
    try {
      await bag.addToBag({productId: p.id, color, size, qty: 1});
      flash();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <h2 className="m-0 font-display text-[36px] leading-tight font-normal tracking-display md:text-display-3">
        <a href={to} className="border-0 text-text-primary hover:text-text-primary">
          {p.name}
        </a>
      </h2>
      <p className="m-0 text-body-md text-text-secondary">{t('piece.body')}</p>
      <div className="flex flex-wrap items-baseline gap-4">
        <span className="text-[20px]">{money(variant?.price ?? p.price, currency, locale)}</span>
        <span className="text-label-sm tracking-label text-text-muted uppercase">{variant?.id ?? p.sku}</span>
      </div>
      {p.swatches.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="text-label-sm tracking-label text-text-secondary uppercase">
            {tp('buy.colourValue', {value: p.swatches.find(s => s.name === color)?.label ?? color})}
          </span>
          <div className="flex gap-2.5" role="group" aria-label={tp('buy.colour')}>
            {p.swatches.map(s => (
              <Swatch
                key={s.name}
                swatch={s}
                on={color === s.name}
                onPick={() => setColor(s.name)}
                className="size-6 rounded-full border border-hairline p-0 outline-offset-[3px]"
              />
            ))}
          </div>
        </div>
      )}
      {p.sizes.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="text-label-sm tracking-label text-text-secondary uppercase">{tp('buy.sizeValue', {value: size})}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={tp('buy.size')}>
            {p.sizes.map(s => {
              const out = soldOut.includes(s);
              const on = size === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={out}
                  aria-pressed={on}
                  aria-label={out ? tp('buy.sizeSoldOut', {size: s}) : s}
                  onClick={() => setSize(s)}
                  className={cn(
                    'h-11 min-w-[52px] rounded-none border px-3 font-sans text-label-md tracking-label transition-hover',
                    on ? 'border-strong bg-ink-900 text-ink-000' : 'border-hairline bg-transparent text-ink-900 hover:border-strong',
                    out && 'cursor-not-allowed opacity-34 hover:border-hairline'
                  )}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <span className={cn('text-label-sm tracking-label uppercase', stock.cls)} aria-live="polite">
        {stock.label}
      </span>
      <div className="mt-1 flex gap-3">
        {unavailable ? (
          <Button href={to} variant="solid" size="lg" fullWidth className="min-w-0 flex-1">
            {tp('tile.notifyMe')}
          </Button>
        ) : (
          <Button
            variant="solid"
            size="lg"
            fullWidth
            className="min-w-0 flex-1"
            onClick={onAdd}
            loading={pending}>
            {added ? tp('tile.addedToBag') : tp('tile.addToBag')}
          </Button>
        )}
        <button
          type="button"
          onClick={toggle}
          title={wished ? tp('tile.removeFromWishlist') : tp('tile.addToWishlist')}
          aria-label={
            wished ? tp('tile.removeNameFromWishlist', {name: p.name}) : tp('tile.addNameToWishlist', {name: p.name})
          }
          aria-pressed={wished}
          data-wish={wished ? 'on' : 'off'}
          className={cn(
            'flex w-14 shrink-0 items-center justify-center self-stretch rounded-none border border-strong bg-transparent transition-hover',
            wished ? 'text-signal-critical' : 'text-ink-900 hover:text-ink-500'
          )}>
          <Icon name="heart" size={19} />
        </button>
      </div>
      <span className="text-body-xs text-text-muted">{t('piece.note')}</span>
    </>
  );
}

export function FeaturedBuyBox({product, ...props}: HomeProps & {product: Product}) {
  return (
    <HomeText {...props}>
      <div className="flex flex-col gap-5">
        <BuyBox product={product} currency={props.currency} />
      </div>
    </HomeText>
  );
}
