/* Promotions display helpers shared by the bag drawer, cart, checkout, confirmation and order pages
   (port of VAREL src/pages/checkout/discounts.tsx, docs/PROMOTIONS.md). VAREL read words from the global i18next;
   here the helpers take the `checkout` translator (default English) and the components read it from the nearest
   <TextProvider> (`useCartText('checkout')`). Error codes on the wire are lower-case (`discount_minimum`), while
   `Cart.discountError.code` comes from the engine upper-case: every set below is compared case-insensitively. */
import type {AppliedDiscountSummary, Cart} from '@/lib/types/cart';
import {cn} from '@/lib/utils';

import {minusMoney, money, priceText} from './money';
import {englishText, useCartText, type Translate} from './text';

const upper = (codes: string[]) => new Set(codes.map(c => c.toUpperCase()));

/** Checkout failures caused by the stored code (customer-dependent, or it became unusable since it was applied):
 *  the code stays on the bag and the customer removes it. Mirrors the 422s of POST /site-api/checkout. */
export const CUSTOMER_DISCOUNT_ERRORS = upper([
  'DISCOUNT_INVALID',
  'DISCOUNT_INACTIVE',
  'DISCOUNT_NOT_STARTED',
  'DISCOUNT_EXPIRED',
  'DISCOUNT_USED_UP',
  'DISCOUNT_NOT_ELIGIBLE',
  'DISCOUNT_CUSTOMER_LIMIT',
]);

/** Codes that are informative rather than wrong: shown in notice colour. */
export const NOTICE_DISCOUNT_ERRORS = upper(['DISCOUNT_NOT_COMBINABLE', 'DISCOUNT_MINIMUM', 'DISCOUNT_MIN_QTY']);

/** `isDiscountError(NOTICE_DISCOUNT_ERRORS, err.code)`: wire codes (`discount_minimum`) and engine codes alike. */
export const isDiscountError = (set: Set<string>, code: string | null | undefined): boolean =>
  !!code && set.has(code.toUpperCase());

/** Whether the bag's stored code is one of the discounts actually applied. */
export function codeApplies(cart: Pick<Cart, 'discountCode' | 'totals'>): boolean {
  const code = cart.discountCode;
  if (!code) return false;
  const list = cart.totals.discounts;
  if (list) return list.some(d => d.code?.toUpperCase() === code.toUpperCase());
  return cart.totals.discountCode?.toUpperCase() === code.toUpperCase();
}

export interface DiscountSource {
  discount: number;
  discountCode: string | null;
  discounts?: AppliedDiscountSummary[] | null;
}

/** Applied discounts, with a fallback for responses that predate `discounts` (one synthetic row from the total). */
export function appliedDiscounts(src: DiscountSource, t: Translate = englishText('checkout')): AppliedDiscountSummary[] {
  if (src.discounts) return src.discounts;
  if (src.discount > 0) {
    return [
      {
        id: 'legacy',
        label: src.discountCode ?? t('discount.fallback'),
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

/** "Free · FREESHIP" (code) or "Free · Free shipping weekend" (automatic). */
export const freeShippingText = (d: AppliedDiscountSummary, t: Translate = englishText('checkout')) =>
  t('totals.freeWith', {name: d.code ?? d.label});

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
  t: Translate = englishText('checkout')
): string {
  const merch = list.filter(d => d.amount > 0);
  if (merch.length === 1) return discountDescriptor(merch[0]);
  const unit = line.unit ?? line.price ?? 0;
  const free = unit > 0 ? line.discount / unit : 0;
  if (free >= 1 && Math.abs(free - Math.round(free)) < 0.001) {
    return t('discount.lineFree', {count: Math.round(free), amount: minusMoney(line.discount)});
  }
  return minusMoney(line.discount);
}

/** Line total, struck through when the line carries a discount, with the amount after it. */
export function LinePrice({
  total,
  discount,
  className,
  align = 'right',
  locale = 'en',
}: {
  total: number;
  discount?: number | null;
  className?: string;
  align?: 'right' | 'left';
  /** Page language for "Free" */
  locale?: string;
}) {
  const t = useCartText('checkout');
  const d = discount ?? 0;
  if (d <= 0) {
    return <span className={cn('whitespace-nowrap', align === 'right' && 'text-right', className)}>{priceText(total, locale)}</span>;
  }
  const after = Math.max(0, Math.round((total - d) * 100) / 100);
  return (
    <span
      className={cn(
        'inline-flex flex-col gap-0.5 whitespace-nowrap',
        align === 'right' ? 'items-end text-right' : 'items-start',
        className
      )}>
      <span className="text-[12px] text-text-muted line-through">
        <span className="sr-only">{t('totals.was')}</span>
        {money(total)}
      </span>
      <span>
        <span className="sr-only">{t('totals.now')}</span>
        {priceText(after, locale)}
      </span>
    </span>
  );
}

/** Small positive note under a discounted line: "Buy 2 get 1 free", "Autumn knitwear · 15% off". */
export function LineDiscountNote({children, className}: {children: string; className?: string}) {
  return <span className={cn('text-label-sm tracking-label text-signal-positive uppercase', className)}>{children}</span>;
}

/** Remove control for a code row in the totals. */
export function RemoveCodeButton({
  code,
  onRemove,
  disabled,
  pending,
  className,
  children,
}: {
  code: string;
  onRemove: () => void;
  disabled?: boolean;
  /** The removal is running: present-tense label, aria-busy (AGENTS.md buttons) */
  pending?: boolean;
  className?: string;
  children?: string;
}) {
  const t = useCartText('checkout');
  const tc = useCartText('cart');
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-label={t('discount.removeAria', {code})}
      className={cn(
        'border-0 border-b border-hairline bg-transparent p-0 text-[12px] leading-snug text-text-secondary transition-hover hover:border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-48',
        className
      )}>
      {pending ? tc('removing') : (children ?? t('discount.remove'))}
    </button>
  );
}

/** "You save $X" under the total, when anything is taken off merchandise. */
export function SavingsLine({amount, className}: {amount: number; className?: string}) {
  const t = useCartText('checkout');
  if (!(amount > 0)) return null;
  return (
    <span className={cn('text-label-md tracking-label text-signal-positive uppercase', className)}>
      {t('totals.youSave', {amount: money(amount)})}
    </span>
  );
}
