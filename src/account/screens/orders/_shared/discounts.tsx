/* TEMPORARY copy of the promotion display helpers WP-12 ports from VAREL src/pages/checkout/{discounts,TotalsTable}.tsx
   (`appliedDiscounts`, `merchandiseDiscounts`, `lineDiscountNote`, `LinePrice`, `LineDiscountNote`, `SavingsLine`,
   `DiscountRows`, `ShippingRow`), so the order screens build before WP-12 merges. Differences from VAREL: every
   amount is formatted in the ORDER's currency (`currency` prop) and words come from the caller's `t` (no global
   i18n). The integrator swaps these imports for `@/components/checkout/*` once WP-12 accepts a `currency` prop, then
   deletes this file (WP-14 hand-off, Requests). */
import type {ReactNode} from 'react';

import type {TFunction} from '@/lib/i18n';
import {minusMoney, money, priceText} from '@/lib/format';
import type {AppliedDiscountSummary} from '@/lib/types/cart';
import {cn} from '@/lib/utils';

export interface DiscountSource {
  discount: number;
  discountCode: string | null;
  discounts?: AppliedDiscountSummary[] | null;
}

/** Applied discounts, with a fallback for responses that predate `discounts` (one synthetic row from the total). */
export function appliedDiscounts(src: DiscountSource, t?: TFunction): AppliedDiscountSummary[] {
  if (src.discounts) return src.discounts;
  if (src.discount > 0) {
    return [
      {
        id: 'legacy',
        label: src.discountCode ?? (t ? t('checkout:discount.fallback') : 'Discount'),
        code: src.discountCode,
        automatic: !src.discountCode,
        amount: src.discount,
        freeShipping: false,
      },
    ];
  }
  return [];
}

/** Rows that reduce merchandise (one per discount). Free-shipping-only discounts show on the shipping row instead. */
export const merchandiseDiscounts = (list: AppliedDiscountSummary[]) => list.filter(d => d.amount > 0 || !d.freeShipping);

/** The discount that makes shipping free, if any. */
export const shippingDiscount = (list: AppliedDiscountSummary[]) => list.find(d => d.freeShipping) ?? null;

/** The part of a label after the code: "STUDIO10 · 10% off" → "10% off". Automatic labels stay whole. */
export function discountDescriptor(d: AppliedDiscountSummary): string {
  if (d.code && d.label.startsWith(d.code)) {
    const rest = d.label.slice(d.code.length).replace(/^\s*·\s*/, '');
    return rest || d.label;
  }
  return d.label;
}

/** Note under a discounted line: the offer's name when only one applies, otherwise the amount. */
export function lineDiscountNote(
  line: {discount: number; unit?: number; price?: number; qty: number},
  list: AppliedDiscountSummary[],
  t: TFunction,
  currency?: string | null,
  locale?: string | null
): string {
  const merch = list.filter(d => d.amount > 0);
  if (merch.length === 1) return discountDescriptor(merch[0]!);
  const unit = line.unit ?? line.price ?? 0;
  const free = unit > 0 ? line.discount / unit : 0;
  if (free >= 1 && Math.abs(free - Math.round(free)) < 0.001) {
    return t('checkout:discount.lineFree', {count: Math.round(free), amount: minusMoney(line.discount, currency, locale)});
  }
  return minusMoney(line.discount, currency, locale);
}

/** Line total, struck through when the line carries a discount, with the amount after it. */
export function LinePrice({
  total,
  discount,
  t,
  currency,
  locale,
  className,
}: {
  total: number;
  discount?: number | null;
  t: TFunction;
  currency?: string | null;
  locale?: string | null;
  className?: string;
}) {
  const d = discount ?? 0;
  if (d <= 0) return <span className={cn('whitespace-nowrap text-right', className)}>{priceText(total, locale, currency)}</span>;
  const after = Math.max(0, Math.round((total - d) * 100) / 100);
  return (
    <span className={cn('inline-flex flex-col items-end gap-0.5 whitespace-nowrap text-right', className)}>
      <span className="text-[12px] text-text-muted line-through">
        <span className="sr-only">{t('checkout:totals.was')}</span>
        {money(total, currency, locale)}
      </span>
      <span>
        <span className="sr-only">{t('checkout:totals.now')}</span>
        {priceText(after, locale, currency)}
      </span>
    </span>
  );
}

/** Small positive note under a discounted line: "Buy 2 get 1 free", "Autumn knitwear · 15% off". */
export function LineDiscountNote({children, className}: {children: string; className?: string}) {
  return <span className={cn('text-label-sm tracking-label text-signal-positive uppercase', className)}>{children}</span>;
}

/** "You save $X" under the total, when anything is taken off merchandise. */
export function SavingsLine({
  amount,
  t,
  currency,
  locale,
  className,
}: {
  amount: number;
  t: TFunction;
  currency?: string | null;
  locale?: string | null;
  className?: string;
}) {
  if (!(amount > 0)) return null;
  return (
    <span className={cn('text-label-md tracking-label text-signal-positive uppercase', className)}>
      {t('checkout:totals.youSave', {amount: money(Number(amount.toFixed(2)), currency, locale)})}
    </span>
  );
}

function Row({label, value, className, muted = true}: {label: ReactNode; value: ReactNode; className?: string; muted?: boolean}) {
  return (
    <div className={cn('flex justify-between gap-4', className)}>
      <span className={cn('min-w-0', muted && 'text-text-secondary')}>{label}</span>
      <span className="shrink-0 text-right">{value}</span>
    </div>
  );
}

/** One signal-positive row per merchandise discount. */
export function DiscountRows({
  list,
  currency,
  locale,
}: {
  list: AppliedDiscountSummary[];
  currency?: string | null;
  locale?: string | null;
}) {
  return (
    <>
      {merchandiseDiscounts(list).map(d => (
        <Row
          key={d.id + d.label}
          muted={false}
          className="text-signal-positive"
          label={<span>{d.label}</span>}
          value={minusMoney(d.amount, currency, locale)}
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
  t,
}: {
  label: ReactNode;
  value: string;
  list: AppliedDiscountSummary[];
  /** Nothing ships (digital-only), so a free-shipping offer has nothing to show */
  noShipping?: boolean;
  t: TFunction;
}) {
  const free = noShipping ? null : shippingDiscount(list);
  return (
    <Row
      label={<span>{label}</span>}
      value={free ? <span className="text-signal-positive">{t('checkout:totals.freeWith', {name: free.code ?? free.label})}</span> : value}
    />
  );
}
