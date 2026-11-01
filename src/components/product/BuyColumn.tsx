/* Port of VAREL src/pages/product/BuyColumn.tsx: the PDP's main island (`client:load`). The server renders it with
   the selection the URL asked for (`initial`), so nothing flashes on hydration. The sticky wrapper and the
   accordion moved to the page (`ProductAccordion.astro`, server-rendered, no JS); everything else is VAREL's.
   Cart and wishlist go through the shared bag store (F2 src/lib/stores/bag.ts) instead of TanStack Query. */
import {useEffect, useRef, useState} from 'react';

import {ColorSwatch} from '@/components/varel/ColorSwatch';
import {Icon} from '@/components/varel/Icon';
import {Price} from '@/components/varel/Price';
import {promotionNote} from '@/components/varel/ProductTile';
import {QuantityStepper} from '@/components/varel/QuantityStepper';
import {SizeSelector} from '@/components/varel/SizeSelector';
import {money, priceText} from '@/components/varel/support';
import {type Dicts, TextProvider, useText} from '@/components/varel/text';
import {notify, notifyError} from '@/components/varel/Toast';
import {bag, type AddToBagInput, useWished} from '@/lib/stores/bag';
import type {Product} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {SizeGuideDialog} from './SizeGuideDialog';
import {track} from './track';
import {type SelectionSearch, type StockTone, useVariantSelection} from './useVariantSelection';

const STOCK_COLOR: Record<StockTone, string> = {
  digital: 'text-signal-positive',
  out: 'text-signal-critical',
  low: 'text-signal-notice',
  in: 'text-ink-400',
};

const LABEL = 'font-sans text-label-sm tracking-label text-text-muted uppercase';

/** How long the button reads "Added to bag" after a successful add (VAREL). */
export const ADDED_MS = 1600;

export interface BuyColumnProps {
  product: Product;
  /** `?color=&size=` from the URL (read on the server) */
  initial: SelectionSearch;
  /** The one-line summary (`short`, else the description as plain text), computed on the server so the island
      does not bundle the Markdown parser. */
  summary: string;
}

/** The island: the page's `product` words (dictsFor) and language around the buy column. */
export function BuyColumnIsland({locale, dicts, ...props}: BuyColumnProps & {locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <BuyColumn {...props} />
    </TextProvider>
  );
}

/** Title, price, colour, size, quantity, stock, add to bag, wishlist and the shipping lines. */
export function BuyColumn({product: p, initial, summary}: BuyColumnProps) {
  const t = useText('product');
  const sel = useVariantSelection(p, initial, t);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [pending, setPending] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const addedTimer = useRef<number | undefined>(undefined);
  const busy = useRef(false);
  const wished = useWished(p.id);

  // One product view per mount (a ClientRouter navigation to another product re-mounts the island).
  useEffect(() => {
    track('product_view', {productId: p.id});
  }, [p.id]);

  // The header count and wishlist hearts come from the server once per visit.
  useEffect(() => {
    void bag.sync();
  }, []);

  // A new variant starts again at one piece; never exceed what is on the shelf.
  const variantId = sel.variant?.id;
  useEffect(() => setQty(1), [variantId]);
  const quantity = Math.min(qty, sel.qtyMax);

  useEffect(() => () => window.clearTimeout(addedTimer.current), []);

  const price = sel.variant ? sel.variant.price : p.price;
  const compareAt = p.onSale && p.compareAt ? money(p.compareAt) : undefined;
  const promo = promotionNote(p.promotion, t);

  const addLabel = sel.soldOut
    ? t('tile.soldOut')
    : sel.digital
      ? t('buy.buyDownload')
      : added
        ? t('tile.addedToBag')
        : t('tile.addToBag');

  const onAdd = async () => {
    if (sel.soldOut || busy.current) return;
    busy.current = true;
    setPending(true);
    const chosen = Object.fromEntries(sel.custom.map(o => [o.name, o.value]));
    // `variantId` pins the exact variant (custom options); WP-09's POST /cart/items accepts it (VAREL cart.ts).
    const input: AddToBagInput & {variantId?: string} = {
      productId: p.id,
      variantId: sel.variant?.id,
      color: sel.color,
      size: sel.size,
      qty: quantity,
      ...(sel.custom.length ? {options: chosen} : {}),
    };
    try {
      await bag.addToBag(input);
      setAdded(true);
      window.clearTimeout(addedTimer.current);
      addedTimer.current = window.setTimeout(() => setAdded(false), ADDED_MS);
      notify(t('buy.added', {name: p.name}), {action: t('buy.viewBag'), onAction: bag.openBag});
      track('add_to_cart', {productId: p.id});
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const onWish = async () => {
    try {
      await bag.toggleWishlist(p.id, !wished);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error));
    }
  };

  const wishLabel = wished ? t('tile.removeFromWishlist') : t('tile.addToWishlist');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className={LABEL}>
          {p.brand} · {p.categoryLabel ?? p.category}
        </span>
        <h1 className="font-display text-[36px] leading-tight font-normal tracking-display md:text-[46px]">{p.name}</h1>
        <div className="flex items-baseline gap-3">
          <span className={p.onSale ? 'text-signal-critical' : 'text-ink-900'}>
            <Price amount={priceText(price)} compareAt={compareAt} size="lg" />
          </span>
          <span className="text-label-md text-text-muted">{t('buy.exclVat')}</span>
        </div>
        {promo && <span className="text-label-sm tracking-label text-signal-positive uppercase">{promo}</span>}
        {/* The one-line summary; the full rich description lives in the Details panel below. */}
        {summary && <p className="line-clamp-3 max-w-[52ch] text-[15px] leading-body text-text-secondary">{summary}</p>}
      </div>

      {sel.colors.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className={LABEL}>
            {t('buy.colourValue', {value: p.swatches.find(w => w.name === sel.color)?.label ?? sel.color})}
          </span>
          <div className="flex gap-3" role="group" aria-label={t('buy.colour')}>
            {p.swatches.map(w => (
              <ColorSwatch
                key={w.name}
                color={w.hex}
                label={w.label ?? w.name}
                size={22}
                selected={w.name === sel.color}
                onClick={() => sel.setColor(w.name)}
              />
            ))}
          </div>
        </div>
      )}

      {sel.custom.map(o => (
        <div key={o.name} className="flex flex-col gap-3">
          <span className={LABEL}>{t('buy.optionValue', {name: o.name, value: o.value})}</span>
          <SizeSelector
            sizes={o.values}
            value={o.value}
            soldOut={o.soldOut}
            onChange={v => sel.setOption(o.name, v)}
            label={o.name}
          />
        </div>
      ))}

      {sel.sizes.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className={LABEL}>{t('buy.sizeValue', {value: sel.size ?? '—'})}</span>
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="border-0 border-b border-strong bg-transparent p-0 pb-0.5 font-sans text-label-sm tracking-label text-text-primary uppercase transition-hover hover:text-ink-500">
              {t('buy.sizeGuide')}
            </button>
          </div>
          <SizeSelector sizes={sel.sizes} value={sel.size} soldOut={sel.soldOutSizes} onChange={sel.setSize} />
          <SizeGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} sizes={sel.sizes} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-5">
        <QuantityStepper
          value={quantity}
          min={1}
          max={sel.qtyMax}
          onChange={setQty}
          disabled={sel.soldOut}
          itemLabel={p.name}
          className="h-11"
        />
        <div
          role="status"
          className={cn(
            'flex items-center gap-2.5 font-sans text-label-sm tracking-label uppercase',
            STOCK_COLOR[sel.stockTone]
          )}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {sel.stockLine}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onAdd}
          disabled={sel.soldOut || pending}
          aria-busy={pending || undefined}
          className={cn(
            'h-[52px] flex-1 border-0 bg-ink-900 font-sans text-label-sm tracking-label text-text-inverse uppercase transition-hover',
            sel.soldOut ? 'cursor-not-allowed opacity-48' : 'hover:bg-ink-700 active:opacity-48',
            pending && 'cursor-wait opacity-70'
          )}>
          {addLabel}
        </button>
        <button
          type="button"
          onClick={onWish}
          data-wish={wished ? 'on' : 'off'}
          aria-pressed={wished}
          aria-label={wishLabel}
          title={wishLabel}
          className={cn(
            'flex size-[52px] shrink-0 items-center justify-center border border-strong bg-transparent transition-hover',
            wished ? 'text-signal-critical' : 'text-ink-900 hover:text-ink-500'
          )}>
          <Icon name="heart" size={19} />
        </button>
      </div>

      <div className="flex flex-col gap-2.5 text-body-xs text-text-secondary">
        <span>
          {[
            t('buy.sku', {sku: sel.variant ? sel.variant.id : p.sku}),
            p.material,
            sel.digital ? t('buy.digitalProduct') : t('buy.physicalProduct'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span>{sel.digital ? t('buy.noShipping') : t('buy.ships')}</span>
        <span>{t('buy.returns')}</span>
      </div>
    </div>
  );
}
