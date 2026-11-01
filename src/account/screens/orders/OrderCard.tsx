import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';

import {Icon, Img} from '@/components/varel';
import {money} from '@/lib/format';
import {productLink} from '@/lib/links';
import type {Order, OrderItem} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {useOrdersLocale, useOrdersT} from './host';
import {itemMeta, payTextClass, safeExternalUrl} from './order-utils';
import {outlineAction, underlineAction} from './recipes';
import {StatusChip} from './StatusChip';

function Cell({label, children, className}: {label: string; children: ReactNode; className?: string}) {
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <span className={cn('text-[15px]', className)}>{children}</span>
    </span>
  );
}

/** A product link, or plain text when the product no longer exists (lines keep their purchase-time snapshot). */
function ItemLink({item, locale, className, children}: {item: OrderItem; locale: string; className?: string; children: ReactNode}) {
  if (!item.productId) return <span className={className}>{children}</span>;
  return (
    <a href={productLink(item.productId, locale)} className={className}>
      {children}
    </a>
  );
}

/** One order in Order history: chalk summary bar, item thumbnails, tracking row. */
export function OrderCard({order: o}: {order: Order}) {
  const t = useOrdersT('orders');
  const locale = useOrdersLocale();
  const trackUrl = safeExternalUrl(o.trackingUrl);
  return (
    <article aria-label={t('orderNumber', {number: o.number})} className="flex flex-col border border-hairline">
      <div className="grid grid-cols-2 items-center gap-x-6 gap-y-5 bg-chalk px-5 py-5 sm:grid-cols-3 md:px-6 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <Cell label={t('card.order')} className="[font-variant-numeric:lining-nums]">
          {o.number}
        </Cell>
        <Cell label={t('card.placed')}>{o.date}</Cell>
        <Cell label={t('card.payment')} className={payTextClass(o.payment)}>
          {t(`payment.${o.payment.toLowerCase()}`, {defaultValue: o.payment})}
        </Cell>
        <Cell label={t('card.fulfillment')}>
          <StatusChip status={o.fulfillment} className="text-[15px]" />
        </Cell>
        <Cell label={t('card.total')}>{money(o.total, o.currency, locale)}</Cell>
        <Link
          to="/orders/$number"
          params={{number: o.number}}
          className={outlineAction('max-w-full justify-self-start px-5 py-3 text-center whitespace-normal xl:justify-self-auto')}>
          {t('card.view')}
        </Link>
      </div>
      <div className="flex flex-col gap-5 px-5 py-6 md:px-7">
        <div className="flex flex-wrap gap-5">
          {o.items.map(l => (
            <ItemLink
              key={l.lineId}
              item={l}
              locale={locale}
              className="flex min-w-0 items-center gap-3.5 border-0 text-text-primary hover:text-text-primary">
              <span className="relative block w-16 flex-[0_0_64px]">
                <Img photo={l.image} alt={l.name} ratio="3/4" width={160} sizes="64px" media={false} />
              </span>
              <span className="flex min-w-0 flex-col gap-[5px]">
                <span className="font-display text-[18px] leading-snug">{l.name}</span>
                <span className="text-[13.5px] text-text-secondary">{itemMeta(t, l)}</span>
              </span>
            </ItemLink>
          ))}
        </div>
        {o.tracking && (
          <div className="flex flex-wrap items-center gap-3.5 border-t border-hairline pt-[18px] text-body-xs text-text-secondary">
            <span className="flex items-center gap-2.5 text-text-primary">
              <Icon name="truck" size={15} />
              {o.carrier}
            </span>
            <span>{o.tracking}</span>
            {trackUrl && (
              <a href={trackUrl} target="_blank" rel="noopener noreferrer" className={underlineAction('pb-0.5')}>
                {t('card.track')}
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
