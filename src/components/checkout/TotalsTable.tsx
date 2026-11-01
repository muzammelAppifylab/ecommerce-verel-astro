/* Subtotal · discounts · shipping · tax rows (port of VAREL src/pages/checkout/TotalsTable.tsx), as on the bag
   drawer, Cart, Checkout, Order Confirmation and order details. Displays server numbers only.
   CSP: VAREL's `style={{fontSize}}` on TotalLine is a class here (no style="" in server HTML). */
import type {ReactNode} from 'react';

import type {AppliedDiscountSummary} from '@/lib/types/cart';
import {useText} from '@/components/varel/text';
import {cn} from '@/lib/utils';

import {appliedDiscounts, freeShippingText, merchandiseDiscounts, RemoveCodeButton, shippingDiscount} from './discounts';
import {useMoney} from './money';

export interface TotalsTableProps {
  subtotal: number;
  discount: number;
  discountCode: string | null;
  /** One row per applied discount (docs/PROMOTIONS.md); falls back to a single row from `discount` */
  discounts?: AppliedDiscountSummary[] | null;
  shippingLabel: string;
  /** Appended to the "Shipping" label, e.g. "express" → "Shipping · express" */
  shippingSuffix?: string | null;
  tax: number;
  taxName: string;
  /** 0.25 → "(25%)" after the tax name; omit to hide */
  taxRate?: number | null;
  /** Prices include tax (Totals.pricesIncludeTax): the tax row reads "Includes VAT (25%)" and is not added */
  pricesIncludeTax?: boolean;
  /** false for digital-only bags (nothing ships, so no free-shipping row); from Totals.physical */
  physical?: boolean;
  /** Shows a remove control on code rows (bag, cart, checkout) */
  onRemoveCode?: () => void;
  removing?: boolean;
  className?: string;
  /** Extra rows rendered at the end (e.g. "Total paid" on the confirmation) */
  children?: ReactNode;
}

function Row({label, value, className, muted = true}: {label: ReactNode; value: ReactNode; className?: string; muted?: boolean}) {
  return (
    <div className={cn('flex justify-between gap-4', className)}>
      <span className={cn('min-w-0', muted && 'text-text-secondary')}>{label}</span>
      <span className="shrink-0 text-right">{value}</span>
    </div>
  );
}

/** Subtotal · discounts · shipping · tax rows. Displays server numbers only. */
export function TotalsTable({
  subtotal,
  discount,
  discountCode,
  discounts,
  shippingLabel,
  shippingSuffix,
  tax,
  taxName,
  taxRate,
  pricesIncludeTax,
  physical,
  onRemoveCode,
  removing,
  className,
  children,
}: TotalsTableProps) {
  const t = useText('checkout');
  const m = useMoney();
  const taxText = taxRate != null ? t('totals.taxRate', {name: taxName, rate: Math.round(taxRate * 10_000) / 100}) : taxName;
  const list = appliedDiscounts({discount, discountCode, discounts}, t);
  return (
    <div className={cn('flex flex-col gap-3 text-body-sm', className)}>
      <Row label={t('totals.subtotal')} value={m.money(subtotal)} />
      <DiscountRows list={list} onRemoveCode={onRemoveCode} removing={removing} />
      <ShippingRow
        label={shippingSuffix ? t('totals.shippingWith', {method: shippingSuffix}) : t('totals.shipping')}
        value={shippingLabel}
        list={list}
        noShipping={physical === false}
        onRemoveCode={onRemoveCode}
        removing={removing}
      />
      <Row label={pricesIncludeTax ? t('totals.includes', {tax: taxText}) : taxText} value={m.money(Number(tax.toFixed(2)))} />
      {children}
    </div>
  );
}

/** One signal-positive row per merchandise discount; code rows carry a remove control when `onRemoveCode` is given. */
export function DiscountRows({
  list,
  onRemoveCode,
  removing,
  className,
}: {
  list: AppliedDiscountSummary[];
  onRemoveCode?: () => void;
  removing?: boolean;
  className?: string;
}) {
  const m = useMoney();
  return (
    <>
      {merchandiseDiscounts(list).map(d => (
        <Row
          key={d.id + d.label}
          muted={false}
          className={cn('text-signal-positive', className)}
          label={
            <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span>{d.label}</span>
              {d.code && onRemoveCode && <RemoveCodeButton code={d.code} onRemove={onRemoveCode} disabled={removing} />}
            </span>
          }
          value={m.minus(d.amount)}
        />
      ))}
    </>
  );
}

/** Shipping row; a free-shipping discount reads "Free · FREESHIP". */
export function ShippingRow({
  label,
  value,
  list,
  noShipping,
  onRemoveCode,
  removing,
  className,
}: {
  label: ReactNode;
  value: string;
  list: AppliedDiscountSummary[];
  /** Nothing ships (digital-only), so a free-shipping offer has nothing to show */
  noShipping?: boolean;
  onRemoveCode?: () => void;
  removing?: boolean;
  className?: string;
}) {
  const t = useText('checkout');
  // Digital-only bags have nothing to ship, so a free-shipping offer has nothing to show.
  const free = noShipping || value.startsWith('No shipping') ? null : shippingDiscount(list);
  // A free-shipping code that also takes money off already has its own row (and remove control).
  const removable = !!free?.code && !!onRemoveCode && !(free.amount > 0);
  return (
    <Row
      className={className}
      label={
        <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span>{label}</span>
          {removable && <RemoveCodeButton code={free.code!} onRemove={onRemoveCode!} disabled={removing} />}
        </span>
      }
      value={free ? <span className="text-signal-positive">{freeShippingText(free, t)}</span> : value}
    />
  );
}

/** Font sizes TotalLine knows as classes (the CSP forbids style=""). */
const TOTAL_SIZE: Record<number, string> = {18: 'text-[18px]', 20: 'text-[20px]', 24: 'text-[24px]', 26: 'text-[26px]', 28: 'text-[28px]'};

/** The ruled "Total" line under the totals table. */
export function TotalLine({total, size = 24, className}: {total: number; size?: 18 | 20 | 24 | 26 | 28; className?: string}) {
  const t = useText('checkout');
  const m = useMoney();
  return (
    <div className={cn('flex items-baseline justify-between gap-4 border-t border-strong pt-[18px]', className)}>
      <span className="text-label-md tracking-label uppercase">{t('totals.total')}</span>
      <span className={TOTAL_SIZE[size] ?? TOTAL_SIZE[24]}>{m.money(Number(total.toFixed(2)))}</span>
    </div>
  );
}
