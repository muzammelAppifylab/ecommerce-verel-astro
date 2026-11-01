import type {ReactNode} from 'react';

import {money, priceText} from '@/lib/format';
import type {Order} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {appliedDiscounts, DiscountRows, SavingsLine, ShippingRow} from './_shared/discounts';
import {useOrdersLocale, useOrdersT} from './host';
import {taxPercent} from './order-utils';

function Row({label, value, className}: {label: ReactNode; value: ReactNode; className?: string}) {
  return (
    <div className={cn('flex justify-between gap-4', className)}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Order details aside: subtotal, discounts, shipping, tax, total, savings, card (VAREL OrderDetails PaymentSummary).
    Every amount in the order's currency. */
export function PaymentSummary({order: o}: {order: Order}) {
  const t = useOrdersT('orders');
  const locale = useOrdersLocale();
  const cur = o.currency;
  const shippingLabel = !o.address && o.shipping === 0 ? t('noShippingDigital') : priceText(o.shipping, locale, cur);
  const list = appliedDiscounts(o, t);
  // Orders snapshot their currency, tax mode and rate (older orders: 25% VAT added on top).
  const taxText = t(o.pricesIncludeTax ? 'details.includesVat' : 'details.vat', {rate: taxPercent(o.taxRate)});
  return (
    <div className="flex flex-col gap-3 border border-hairline p-7">
      <h2 className="m-0 font-sans text-[16px] font-normal text-text-primary">{t('details.paymentSummary')}</h2>
      <div className="flex flex-col gap-2.5 text-body-sm">
        <Row label={<span className="text-text-secondary">{t('details.subtotal')}</span>} value={money(o.subtotal, cur, locale)} />
        <DiscountRows list={list} currency={cur} locale={locale} />
        <ShippingRow
          label={t('details.shippingWith', {method: o.method})}
          value={shippingLabel}
          list={list}
          noShipping={!o.address}
          t={t}
        />
        <Row label={<span className="text-text-secondary">{taxText}</span>} value={money(o.tax, cur, locale)} />
        <Row
          className="mt-1 border-t border-strong pt-3"
          label={t('details.total')}
          value={<span className="text-body-lg">{money(o.total, cur, locale)}</span>}
        />
        <SavingsLine amount={o.discount} t={t} currency={cur} locale={locale} className="self-end" />
        {o.cardLast4 && (
          <span className="text-body-xs text-text-muted">
            {o.cardBrand
              ? t('details.brandEnding', {brand: o.cardBrand, last4: o.cardLast4})
              : t('details.ending', {last4: o.cardLast4})}
          </span>
        )}
      </div>
    </div>
  );
}
