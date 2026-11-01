/* Checkout aside: lines, discount code, totals, legal note (port of VAREL src/pages/checkout/OrderSummary.tsx).
   Chalk ground. State lives in the checkout island: removing the code goes through `onRemoveCode` / `onCart`. */
import {useId, useState} from 'react';

import {Icon, Img, Skeleton} from '@/components/varel';
import {type Translate, useText} from '@/components/varel/text';
import {dotJoin} from '@/lib/format';
import type {AppliedDiscountSummary, Cart, CartLine, DiscountContext, Totals} from '@/lib/types/cart';
import {cn} from '@/lib/utils';

import {removeDiscount} from './checkout-api';
import {DiscountForm} from './DiscountForm';
import {appliedDiscounts, LineDiscountNote, lineDiscountNote, LinePrice, SavingsLine} from './discounts';
import {useMoney} from './money';
import {TotalLine, TotalsTable} from './TotalsTable';
import {LABEL_HEADING} from './ui';
import {bag} from '@/lib/stores/bag';

/** "Stone · M · Qty 1": colour in the request language when the API sends `colorLabel` (order snapshots stay English). */
export const lineMeta = (
  l: Pick<CartLine, 'color' | 'size' | 'qty'> & {colorLabel?: string | null; options?: Record<string, string>},
  t: Translate
) => dotJoin(l.colorLabel ?? l.color, l.size, ...Object.values(l.options ?? {}), t('qty', {qty: l.qty}));

/** 64px thumbnail row in the checkout summary. */
export function SummaryLine({line, discounts = []}: {line: CartLine; discounts?: AppliedDiscountSummary[]}) {
  const t = useText('checkout');
  const m = useMoney();
  const d = line.discount ?? 0;
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-start gap-4">
      <Img photo={line.image} alt={line.alt} width={160} className="w-16 bg-ink-100" media={false} />
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="font-display text-[19px] leading-display">{line.name}</span>
        <span className="text-[12px] text-text-muted">{lineMeta(line, t)}</span>
        {d > 0 && <LineDiscountNote>{lineDiscountNote(line, discounts, t, m)}</LineDiscountNote>}
      </span>
      <LinePrice total={line.total} discount={d} className="text-body-sm" />
    </div>
  );
}

export interface OrderSummaryProps {
  cart: Cart;
  /** Live checkout totals (country + method); falls back to the bag totals */
  totals?: Totals | null;
  /** "express" | "digital" | "—" */
  methodLabel: string;
  /** Country, shipping method and email the totals are priced for (sent with a new code) */
  discountContext?: DiscountContext;
  /** Customer-dependent discount failure from POST /site-api/checkout, shown next to the code */
  codeError?: {code: string; message: string} | null;
  onCodeRemoved?: () => void;
  /** The bag after a code was applied or removed here (the island refreshes its totals) */
  onCart?: (cart: Cart) => void;
  /** Phones and tablets: collapsed to a "Show order summary · total" bar until opened (Shopify pattern) */
  collapsible?: boolean;
  /** Return window from the store settings */
  returnDays?: number;
  className?: string;
}

export function OrderSummary({
  cart,
  totals,
  methodLabel,
  discountContext,
  codeError,
  onCodeRemoved,
  onCart,
  collapsible = false,
  returnDays = 30,
  className,
}: OrderSummaryProps) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const bodyId = useId();
  const tr = useText('checkout');
  const m = useMoney();
  const t = totals ?? cart.totals;
  const list = appliedDiscounts(t, tr);
  // Live totals carry the line allocations and the code's status at the selected rate and email; the bag's own
  // are priced without shipping, and the winning offer can differ (e.g. free shipping on an express order).
  const lines = t.lineDiscounts ? cart.lines.map(l => ({...l, discount: t.lineDiscounts?.[l.lineId] ?? 0})) : cart.lines;
  const codeCart = totals
    ? {...cart, totals, discountError: totals.discountError !== undefined ? totals.discountError : cart.discountError}
    : cart;
  const onRemoveCode = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      const next = await removeDiscount();
      bag.applyCart(next);
      onCart?.(next);
      onCodeRemoved?.();
    } catch {
      /* the row stays; the customer can try again */
    } finally {
      setRemoving(false);
    }
  };
  return (
    <aside
      aria-label={tr('summary.title')}
      className={cn(
        'flex flex-col gap-7 bg-chalk px-6 py-10 md:p-12 lg:min-h-screen',
        collapsible && 'max-lg:border-b max-lg:border-hairline max-lg:pt-0',
        collapsible && !open && 'max-lg:pb-0',
        className
      )}>
      {collapsible && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(v => !v)}
          className="flex w-full items-center justify-between gap-4 border-0 bg-transparent py-5 text-left text-text-primary lg:hidden">
          <span className="flex items-center gap-2 text-body-sm">
            {open ? tr('summary.hide') : tr('summary.show')}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
          <span className="text-[17px]">{m.money(Number(t.total.toFixed(2)))}</span>
        </button>
      )}
      <div id={bodyId} className={cn('flex flex-col gap-7', collapsible && !open && 'max-lg:hidden')}>
        <h2 className={cn(LABEL_HEADING, collapsible && 'max-lg:sr-only')}>{tr('summary.title')}</h2>
        <div className="flex flex-col gap-5">
          {lines.map(l => (
            <SummaryLine key={l.lineId} line={l} discounts={list} />
          ))}
        </div>

        <DiscountForm
          cart={codeCart}
          collapsible
          context={discountContext}
          id="ck-code"
          checkoutError={codeError}
          onRemoved={onCodeRemoved}
          onCart={onCart}
          className="border-t border-hairline pt-6"
        />

        <TotalsTable
          className="border-t border-hairline pt-6"
          subtotal={t.subtotal}
          discount={t.discount}
          discountCode={t.discountCode}
          discounts={list}
          onRemoveCode={onRemoveCode}
          removing={removing}
          shippingLabel={t.shippingLabel}
          shippingSuffix={methodLabel}
          tax={t.tax}
          taxName={t.taxName}
          taxRate={t.taxRate}
          pricesIncludeTax={t.pricesIncludeTax}
          physical={t.physical}
        />
        <div className="flex flex-col gap-3">
          <TotalLine total={t.total} size={26} />
          <SavingsLine amount={t.discount} className="self-end" />
        </div>
        <p className="m-0 text-[12px] leading-body text-text-muted">{tr('summary.note', {tax: t.taxName, count: returnDays})}</p>
      </div>
    </aside>
  );
}

export function OrderSummarySkeleton() {
  return (
    <aside aria-hidden="true" className="flex flex-col gap-7 bg-chalk px-6 py-10 md:p-12 lg:min-h-screen">
      <Skeleton className="h-3 w-28" />
      {[0, 1, 2].map(i => (
        <div key={i} className="grid grid-cols-[64px_1fr] gap-4">
          <Skeleton className="aspect-[3/4] w-16 bg-ink-100" />
          <Skeleton className="h-4 w-3/5 bg-ink-100" />
        </div>
      ))}
    </aside>
  );
}
