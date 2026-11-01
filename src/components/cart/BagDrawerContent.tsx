/*
 * The bag drawer's content (WP-09; the frame is F2's src/components/layout/BagDrawer.tsx, which renders this inside
 * its sheet under the title "Your bag (n)"). Port of VAREL `layout/BagDrawer.tsx`: lines with quantity and remove,
 * free-shipping progress, a stored code that is not applying yet, discount rows, totals, checkout buttons.
 *
 * Reads the bag from the bag store (./cart-store): fetched when the drawer opens (fresh for 10 s), and replaced by
 * every add-to-bag anywhere on the page. Words: `layout` from the header's provider; `checkout` and `product.stock`
 * with English behind them (./text) until the header passes those catalogs too (Request to F2 in the hand-off).
 */
import {useEffect, useRef, useState} from 'react';

import {Button} from '@/components/varel/Button';
import {Img} from '@/components/varel/Img';
import {QuantityStepper} from '@/components/varel/QuantityStepper';
import {Spinner} from '@/components/varel/Spinner';
import {useElementStyle} from '@/components/varel/element-style';
import {useLocale, useText} from '@/components/varel/text';
import {dotJoin} from '@/lib/format';
import {productLink} from '@/lib/links';
import {lineStock} from '@/lib/product';
import {cn} from '@/lib/utils';

import {cartStore, removeDiscount, removeLine, updateLine, useCart} from './cart-store';
import {
  appliedDiscounts,
  codeApplies,
  freeShippingText,
  LineDiscountNote,
  lineDiscountNote,
  LinePrice,
  RemoveCodeButton,
  SavingsLine,
  shippingDiscount,
} from './discounts';
import {money} from './money';
import {asTFunction, useCartText} from './text';
import {DiscountRows} from './TotalsTable';

export interface BagDrawerContentProps {
  /** Close the drawer (call it before following a link inside it). */
  onClose: () => void;
  /** Localized hrefs */
  links: {shop: string; cart: string; checkout: string};
}

/** The 1px hairline with a 2px ink fill: width set through the CSSOM (no style attribute in server HTML). */
function FreeShippingBar({ratio}: {ratio: number}) {
  const fill = useRef<HTMLSpanElement>(null);
  useElementStyle(fill, {width: `${Math.max(0, Math.min(1, ratio)) * 100}%`});
  return (
    <span className="relative block h-px w-full bg-hairline" aria-hidden="true">
      <span ref={fill} className="absolute inset-y-[-0.5px] left-0 h-0.5 w-0 bg-ink-900 transition-[width] duration-400 ease-standard" />
    </span>
  );
}

export function BagDrawerContent({onClose, links}: BagDrawerContentProps) {
  const t = useText('layout');
  const tCheckout = useCartText('checkout');
  const tProduct = useCartText('product');
  const locale = useLocale();
  const {cart, status} = useCart();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removingCode, setRemovingCode] = useState(false);

  // Opening the drawer reads the bag (skipped while the cache is fresh).
  useEffect(() => {
    void cartStore.load();
  }, []);

  const lines = cart?.lines ?? [];
  const tot = cart?.totals;
  const progress = tot && tot.freeThreshold ? Math.min(1, tot.subtotal / tot.freeThreshold) : 0;
  const discounts = tot ? appliedDiscounts(tot, tCheckout) : [];
  const freeShip = tot?.physical ? shippingDiscount(discounts) : null;
  const storedCode = cart?.discountCode ?? null;
  const codePending = !!cart && !!storedCode && !codeApplies(cart);
  const loading = !cart && (status === 'loading' || status === 'idle');

  const onRemoveCode = () => {
    if (removingCode) return;
    setRemovingCode(true);
    removeDiscount()
      .catch(() => undefined)
      .finally(() => setRemovingCode(false));
  };

  const onRemoveLine = (lineId: string) => {
    if (removingId) return;
    setRemovingId(lineId);
    removeLine(lineId)
      .catch(() => undefined)
      .finally(() => setRemovingId(null));
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-8 pb-8 text-body-sm max-sm:px-6" aria-busy={loading || undefined}>
        {loading ? (
          <div className="flex justify-center py-16 text-text-muted">
            <Spinner />
          </div>
        ) : lines.length === 0 ? (
          <div className="flex flex-col items-start gap-4 pt-2">
            <h2 className="m-0 font-display text-display-5 font-normal">{t('bag.emptyTitle')}</h2>
            <p className="m-0 text-body-sm text-text-secondary">{t('bag.emptyBody')}</p>
            <Button href={links.shop} variant="outline" onClick={onClose} className="mt-2">
              {t('bag.continueShopping')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {tot?.physical && (
              <div className="flex flex-col gap-2.5">
                <span className="text-body-xs text-text-muted">
                  {freeShip
                    ? t('bag.freeShippingWith', {name: freeShip.code ?? freeShip.label})
                    : tot.toFree > 0
                      ? t('bag.toFree', {amount: money(tot.toFree)})
                      : t('bag.freeApplied')}
                </span>
                <FreeShippingBar ratio={freeShip ? 1 : progress} />
              </div>
            )}
            <ul className="m-0 flex list-none flex-col p-0">
              {lines.map(l => {
                const stock = lineStock(l, asTFunction(tProduct));
                const href = productLink(l.productId, locale);
                const removing = removingId === l.lineId;
                return (
                  <li
                    key={l.lineId}
                    className="grid grid-cols-[84px_minmax(0,1fr)] gap-4 border-t border-hairline py-5 first:border-t-0 first:pt-0">
                    <a href={href} onClick={onClose} className="block border-0" aria-label={l.name}>
                      <Img photo={l.image} alt={l.alt} width={240} />
                    </a>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <a href={href} onClick={onClose} className="min-w-0 border-0 font-display text-[19px] leading-display text-text-primary">
                          {l.name}
                        </a>
                        <LinePrice total={l.total} discount={l.discount} className="text-body-sm" locale={locale} />
                      </div>
                      <span className="text-body-xs text-text-muted">
                        {dotJoin(l.colorLabel ?? l.color, l.size, ...Object.values(l.options ?? {}), l.digital ? t('bag.digital') : null)}
                      </span>
                      <span className={cn('text-label-sm tracking-label uppercase', stock.className)}>{stock.label}</span>
                      {l.discount > 0 && <LineDiscountNote>{lineDiscountNote(l, discounts, tCheckout)}</LineDiscountNote>}
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <QuantityStepper
                          value={l.qty}
                          min={1}
                          max={l.digital ? 1 : Math.max(1, l.inventory ?? 9)}
                          disabled={l.digital || removing}
                          itemLabel={l.name}
                          onChange={qty => {
                            void updateLine(l.lineId, qty).catch(() => undefined);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveLine(l.lineId)}
                          disabled={removingId !== null}
                          aria-busy={removing || undefined}
                          aria-label={t('bag.removeItem', {name: l.name})}
                          className="border-0 border-b border-hairline bg-transparent p-0 pb-0.5 text-label-sm tracking-label text-text-muted uppercase transition-hover hover:border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-48">
                          {t('bag.remove')}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {storedCode && codePending && (
              <div className="flex flex-col gap-1.5 border-t border-hairline pt-5 text-[12px] leading-snug">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-label-sm tracking-label text-text-muted uppercase">{t('bag.codeSaved', {code: storedCode})}</span>
                  <RemoveCodeButton code={storedCode} onRemove={onRemoveCode} pending={removingCode} />
                </span>
                {cart?.discountError && <span className="text-signal-notice">{cart.discountError.message}</span>}
              </div>
            )}
          </div>
        )}
      </div>
      {lines.length > 0 && tot && (
        <div className="mt-auto flex flex-col gap-4 border-t border-hairline px-8 py-6 max-sm:px-6">
          <div className="flex flex-col gap-2 text-body-sm">
            <div className="flex justify-between gap-4">
              <span className="text-text-secondary">{t('bag.subtotal')}</span>
              <span>{money(tot.subtotal)}</span>
            </div>
            <DiscountRows list={discounts} onRemoveCode={onRemoveCode} removing={removingCode} />
            {freeShip && (
              <div className="flex justify-between gap-4">
                <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 text-text-secondary">
                  <span>{t('bag.shipping')}</span>
                  {freeShip.code && !(freeShip.amount > 0) && (
                    <RemoveCodeButton code={freeShip.code} onRemove={onRemoveCode} pending={removingCode} />
                  )}
                </span>
                <span className="text-signal-positive">{freeShippingText(freeShip, tCheckout)}</span>
              </div>
            )}
            <SavingsLine amount={tot.discount} className="mt-1 self-end" />
          </div>
          <Button href={links.checkout} fullWidth onClick={onClose}>
            {t('bag.checkout')}
          </Button>
          <Button href={links.cart} variant="outline" fullWidth onClick={onClose}>
            {t('bag.viewBag')}
          </Button>
          <p className="m-0 text-center text-body-xs text-text-muted">{t('bag.taxesNote')}</p>
        </div>
      )}
    </>
  );
}
