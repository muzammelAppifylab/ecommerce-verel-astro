/* Order details (VAREL src/pages/OrderDetails.tsx): progress, items, payment summary, address, help; invoice print;
   cancel before packing; start a return once shipped. Route `/orders/$number/` of the account app (WP-13). */
import {useQuery} from '@tanstack/react-query';
import {Link, useParams} from '@tanstack/react-router';
import {type ReactNode, useState} from 'react';

import {Button, EmptyState, Icon, Img} from '@/components/varel';
import {money, priceText} from '@/lib/format';
import {href, productLink, returnsLink} from '@/lib/links';
import {errorMessage, isApiError} from '@/lib/storefront-api';
import type {OrderItem} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {appliedDiscounts, LineDiscountNote, lineDiscountNote, LinePrice} from './_shared/discounts';
import {CancelDialog} from './CancelDialog';
import {DetailsSkeleton, STAGES} from './DetailsSkeleton';
import {useOrdersLocale, useOrdersT, useOrdersTitle} from './host';
import {Invoice, printInvoice, useStoreName} from './Invoice';
import {addressBlock, downloadHref, payTextClass, safeExternalUrl} from './order-utils';
import {PaymentSummary} from './PaymentSummary';
import {orderQuery} from './queries';
import {microLabel, outlineAction, panelTitle, underlineAction} from './recipes';
import {StatusChip} from './StatusChip';

const ITEM_COLS = 'grid-cols-[72px_minmax(0,1fr)_auto] md:grid-cols-[88px_minmax(0,1fr)_90px_110px]';

/** A product link, or plain text when the product no longer exists. */
function ProductAnchor({
  item,
  locale,
  className,
  children,
  ...rest
}: {
  item: OrderItem;
  locale: string;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
  tabIndex?: number;
}) {
  if (!item.productId) return <span className={className}>{children}</span>;
  return (
    <a href={productLink(item.productId, locale)} className={className} {...rest}>
      {children}
    </a>
  );
}

export default function OrderDetails() {
  const params = useParams({strict: false}) as {number?: string};
  const number = decodeURIComponent(params.number ?? '');
  const t = useOrdersT('orders');
  const locale = useOrdersLocale();
  useOrdersTitle(t('orderNumber', {number}));
  const q = useQuery(orderQuery(number));
  const store = useStoreName();
  const [cancelOpen, setCancelOpen] = useState(false);

  if (q.isPending) return <DetailsSkeleton />;

  if (q.isError || !q.data) {
    const missing = isApiError(q.error) && (q.error.status === 404 || q.error.status === 403);
    return (
      <div className="py-16">
        <EmptyState
          title={missing ? t('details.notFound') : t('details.loadError')}
          description={missing ? t('details.notFoundBody', {number}) : errorMessage(q.error)}
          action={
            missing ? (
              <Link to="/orders" className={outlineAction('px-6 py-3.5')}>
                {t('details.orderHistory')}
              </Link>
            ) : (
              <Button variant="outline" onClick={() => void q.refetch()} loading={q.isFetching} loadingLabel={t('tryAgain')}>
                {t('tryAgain')}
              </Button>
            )
          }
        />
      </div>
    );
  }

  const o = q.data;
  const cur = o.currency;
  const payment = t(`payment.${o.payment.toLowerCase()}`, {defaultValue: o.payment});
  const cancelled = o.fulfillment === 'Cancelled';
  // A return needs the parcel: offer it once the order has shipped.
  const returnable = o.fulfillment === 'Shipped' || o.fulfillment === 'Delivered';
  const trackUrl = safeExternalUrl(o.trackingUrl);
  const discounts = appliedDiscounts(o, t);
  return (
    <div className="flex flex-col">
      <Invoice order={o} />
      <header className="flex flex-wrap items-end justify-between gap-8 border-b border-hairline pb-8">
        <div className="flex flex-col gap-2.5">
          <Link
            to="/orders"
            className="inline-flex items-center gap-1.5 self-start border-0 text-[14px] text-text-secondary hover:text-text-primary">
            <Icon name="arrow-left" size={14} />
            {t('details.orderHistory')}
          </Link>
          <h1 className="m-0 font-display text-[34px] leading-[1.1] font-normal tracking-display [font-variant-numeric:lining-nums] md:text-[42px]">
            {t('orderNumber', {number: o.number})}
          </h1>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14.5px] text-text-secondary">
            <span>{t('details.placed', {date: o.date})}</span>
            <StatusChip status={o.fulfillment} />
            <span className={cn('inline-flex items-center gap-2 text-[13.5px]', payTextClass(o.payment))}>
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {payment}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => printInvoice(t, o.number, store)} className={outlineAction('px-[22px] py-3.5')}>
              {t('details.invoice')}
            </button>
            {o.canCancel && (
              <button type="button" onClick={() => setCancelOpen(true)} className={outlineAction('px-[22px] py-3.5')}>
                {t('cancel.button')}
              </button>
            )}
            {returnable && (
              <a href={returnsLink(o.number, locale)} className={outlineAction('px-[22px] py-3.5')}>
                {t('details.startReturn')}
              </a>
            )}
          </div>
          {o.canCancel && <span className="text-body-xs text-text-muted">{t('cancel.hint')}</span>}
        </div>
      </header>

      {cancelled ? (
        <section role="status" className="border-b border-hairline py-10">
          <div className="flex flex-col gap-2 bg-ink-050 p-6 md:p-7">
            <span className="text-[17px] text-text-primary">{t('cancel.cancelledTitle')}</span>
            <p className="m-0 max-w-[62ch] text-body-sm leading-body text-text-secondary">
              {o.payment === 'Refunded'
                ? t('cancel.cancelledBody', {amount: money(o.total, cur, locale)})
                : t('cancel.cancelledBodyUnpaid')}
            </p>
          </div>
        </section>
      ) : (
        <section aria-label={t('details.fulfillmentLabel')} className="flex flex-col gap-7 border-b border-hairline py-10">
          <ol className="m-0 grid list-none grid-cols-2 gap-0.5 p-0 sm:grid-cols-5">
            {STAGES.map((stage, i) => {
              const done = i <= o.stage;
              return (
                <li
                  key={stage}
                  aria-current={i === o.stage ? 'step' : undefined}
                  className={cn(
                    'flex flex-col gap-2.5 p-5',
                    done ? 'bg-ink-900 text-ink-000' : 'bg-ink-050 text-text-secondary',
                    i === STAGES.length - 1 && 'max-sm:col-span-2'
                  )}>
                  <span className={cn(microLabel, 'opacity-72')}>{t('step', {n: i + 1})}</span>
                  <span className="text-[17px]">{t(`stages.${stage}`)}</span>
                </li>
              );
            })}
          </ol>
          {o.tracking && (
            <div className="flex flex-wrap items-center gap-5 text-body-sm text-text-secondary">
              <span className="flex items-center gap-2.5 text-text-primary">
                <Icon name="truck" size={16} />
                {o.carrier}
              </span>
              <span>{t('details.tracking', {number: o.tracking})}</span>
              {trackUrl && (
                <a href={trackUrl} target="_blank" rel="noopener noreferrer" className={underlineAction('pb-0.5')}>
                  {t('details.followParcel')}
                </a>
              )}
            </div>
          )}
          {o.fulfillment === 'Processing' && <p className="m-0 text-body-sm text-text-secondary">{t('cancel.packedNote')}</p>}
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-12 py-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="items-title" className="flex min-w-0 flex-col gap-5">
          <h2 id="items-title" className={panelTitle}>
            {t('details.items')}
          </h2>
          <div className="flex flex-col">
            <div className={cn('grid gap-5 border-b border-strong pb-3 text-text-secondary', microLabel, ITEM_COLS)}>
              <span>{t('details.columns.item')}</span>
              <span />
              <span className="max-md:hidden">{t('details.columns.qty')}</span>
              <span className="text-right">{t('details.columns.total')}</span>
            </div>
            {o.items.map(l => (
              <div key={l.lineId} className={cn('grid items-start gap-5 border-b border-hairline py-[22px]', ITEM_COLS)}>
                <ProductAnchor item={l} locale={locale} className="block border-0" aria-label={l.name} tabIndex={-1}>
                  <Img photo={l.image} alt={l.name} ratio="3/4" width={200} sizes="88px" media={false} />
                </ProductAnchor>
                <div className="flex min-w-0 flex-col gap-2">
                  <ProductAnchor
                    item={l}
                    locale={locale}
                    className="self-start border-0 font-display text-[22px] leading-snug text-text-primary">
                    {l.name}
                  </ProductAnchor>
                  <span className="text-body-xs text-text-muted">
                    {[l.color, l.size, ...Object.values(l.options ?? {})].filter(Boolean).join(' · ') || t('details.digitalProduct')}
                  </span>
                  <span className="text-label-md text-text-muted">
                    {t('details.skuEach', {sku: l.sku, price: priceText(l.price, locale, cur)})}
                    <span className="md:hidden">{t('details.qty', {qty: l.qty})}</span>
                  </span>
                  {l.discount > 0 && <LineDiscountNote>{lineDiscountNote(l, discounts, t, cur, locale)}</LineDiscountNote>}
                  {l.digital && l.download && (
                    <a href={downloadHref(l.download)} download className={outlineAction('mt-1 self-start px-4 py-2.5')}>
                      {t('download')}
                    </a>
                  )}
                </div>
                <span className="text-[15px] max-md:hidden">{l.qty}</span>
                <LinePrice total={l.total} discount={l.discount} t={t} currency={cur} locale={locale} className="text-[15px]" />
              </div>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <PaymentSummary order={o} />
          {o.address && (
            <div className="flex flex-col gap-2.5 border border-hairline p-7">
              <h2 className="m-0 font-sans text-[16px] font-normal text-text-primary">{t('details.shippingAddress')}</h2>
              <span className="text-body-sm leading-body text-text-secondary">{addressBlock(o.address, locale)}</span>
            </div>
          )}
          <div className="flex flex-col gap-2.5 border border-hairline p-7">
            <h2 className="m-0 font-sans text-[16px] font-normal text-text-primary">{t('details.help')}</h2>
            <a href={href('/contact/', locale)} className="self-start text-body-sm">
              {t('contactStudio')}
            </a>
            <a href={returnsLink(o.number, locale)} className="self-start text-body-sm">
              {t('returnsRefunds')}
            </a>
          </div>
        </aside>
      </div>
      {o.canCancel && <CancelDialog order={o} open={cancelOpen} onClose={() => setCancelOpen(false)} />}
    </div>
  );
}
