/* The confirmed order (port of `Confirmation` in VAREL src/pages/OrderConfirmation.tsx): hero, stages, lines,
   payment, address and help cards. Rendered on the server only (no client directive): zero JS. Used for Paid and
   Refunded orders (Refunded reads "Refunded" in the hero label and payment card). */
import {Img} from '@/components/varel';
import {type Dicts, type Translate, TextProvider, useLocale, useText} from '@/components/varel/text';
import {dotJoin} from '@/lib/format';
import {href, orderLink, productLink, returnsLink, shopLink} from '@/lib/links';
import type {Order} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {countryName} from './countries';
import {appliedDiscounts, LineDiscountNote, lineDiscountNote, LinePrice, SavingsLine} from './discounts';
import {CurrencyProvider, useMoney} from './money';
import {lineMeta} from './OrderSummary';
import {TotalsTable} from './TotalsTable';
import {LABEL, LABEL_HEADING, OUTLINE_CTA, SOLID_CTA} from './ui';

const HERO = {
  src: 'https://images.unsplash.com/photo-1633972767447-5098f0322a45',
  credit: 'Photo by Katya Azimova on Unsplash',
  creditHref: 'https://unsplash.com/@_katishna_',
};

const STAGES = ['received', 'processing', 'packed', 'shipped', 'delivered'] as const;

export interface ConfirmationBodyProps {
  order: Order;
  /** The visitor is signed in (tracks from the account; guests see status inline and are invited to sign up) */
  signedIn: boolean;
  /** First name when the order has no address (digital) */
  viewerFirstName?: string | null;
  /** Store tax name and default rate (the order stores amounts; `order.taxRate` wins when present) */
  taxName: string;
  taxRate?: number | null;
  /** Store currency, when the order does not carry its own */
  currency: string;
  /** The `?email=` the guest opened the page with (download links carry it) */
  email?: string | null;
  locale: string;
  dicts: Dicts;
}

export default function ConfirmationBody(props: ConfirmationBodyProps) {
  return (
    <TextProvider locale={props.locale} dicts={props.dicts}>
      <CurrencyProvider currency={props.order.currency ?? props.currency}>
        <Confirmation {...props} />
      </CurrencyProvider>
    </TextProvider>
  );
}

/** `t(key)`, or `fallback` when the catalog has no such key. */
const tOr = (t: Translate, key: string, fallback: string) => {
  const v = t(key);
  return v === key ? fallback : v;
};

/** Guarded download URL (WP-13's route checks the order and email, then redirects to the private file). */
export function downloadHref(file: string, number: string, email?: string | null): string {
  if (/^https?:\/\//i.test(file) || file.startsWith('/')) return file;
  const base = `/site-api/downloads/${encodeURIComponent(file)}`;
  return email ? `${base}?order=${encodeURIComponent(number)}&email=${encodeURIComponent(email)}` : base;
}

/** Staff-entered tracking links: https only. */
export const safeTrackingUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

function Confirmation({order, signedIn, viewerFirstName, taxName, taxRate: storeRate, email}: ConfirmationBodyProps) {
  const t = useText('orders');
  const tc = useText('checkout');
  const locale = useLocale();
  const m = useMoney();
  const taxable = order.subtotal - order.discount;
  const taxRate = order.taxRate ?? storeRate ?? (taxable > 0 ? Math.round((order.tax / taxable) * 100) / 100 : null);

  const a = order.address;
  const firstName = a?.name.split(' ')[0] || viewerFirstName || '';
  const total = m.money(Number(order.total.toFixed(2)));
  const addressBlock = a
    ? [a.name, a.line1, a.line2, `${a.zip} ${a.city}`, countryName(a.country, locale)].filter(Boolean).join(', ')
    : null;
  const shippingLabel = !a ? t('noShippingDigital') : order.shipping === 0 ? t('free') : m.money(order.shipping);
  const payment = tOr(t, `payment.${order.payment.toLowerCase()}`, order.payment);
  const current = Math.min(4, Math.max(1, order.stage));
  const discounts = appliedDiscounts(order, tc);
  const trackingUrl = safeTrackingUrl(order.trackingUrl);
  const guestEmail = signedIn ? null : (email ?? order.email);

  return (
    <div className="mx-auto w-full max-w-page">
      <section className="grid grid-cols-1 items-stretch gap-0.5 md:grid-cols-2">
        <div className="flex flex-col justify-center gap-[22px] bg-chalk px-6 py-14 md:px-12 md:py-20">
          <span className={cn(LABEL, 'text-signal-positive')}>
            {order.payment === 'Paid' ? t('confirmation.paymentReceived') : payment}
          </span>
          <h1 className="m-0 font-display text-[40px] leading-tight font-normal tracking-display md:text-[54px]">
            {firstName ? t('confirmation.thanksName', {name: firstName}) : t('confirmation.thanks')}
          </h1>
          <p className="m-0 max-w-[44ch] text-body-md leading-body text-text-secondary">
            {t('confirmation.confirmedBody', {email: order.email})}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-10 gap-y-4">
            <Fact label={t('confirmation.factOrder')} value={order.number} />
            <Fact label={t('confirmation.factPlaced')} value={order.date} />
            <Fact label={t('confirmation.factTotal')} value={total} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {signedIn ? (
              <a href={orderLink(order.number, locale)} className={cn(SOLID_CTA, 'px-6 py-[15px]')}>
                {t('confirmation.track')}
              </a>
            ) : (
              <a href={href('/account/register/', null, {email: order.email})} className={cn(SOLID_CTA, 'px-6 py-[15px]')}>
                {t('confirmation.createAccount')}
              </a>
            )}
            <a href={shopLink(locale)} className={cn(OUTLINE_CTA, 'px-6 py-[15px]')}>
              {t('continueShopping')}
            </a>
          </div>
        </div>
        <div className="relative min-h-[360px] bg-ink-100 md:min-h-[520px]">
          <Img photo={HERO} alt={t('confirmation.heroAlt')} ratio="fill" width={1400} priority media={false} />
        </div>
      </section>

      <section aria-label={t('confirmation.statusLabel')} className="border-b border-hairline px-6 py-14 md:px-12">
        <ol className="m-0 grid list-none grid-cols-1 gap-0.5 p-0 sm:grid-cols-5">
          {STAGES.map((stage, i) => {
            const on = i <= current;
            return (
              <li
                key={stage}
                aria-current={i === current ? 'step' : undefined}
                className={cn('flex flex-col gap-3 p-5', on ? 'bg-ink-900 text-ink-000' : 'bg-ink-050 text-ink-400')}>
                <span className={cn(LABEL, 'opacity-72')}>{t('step', {n: i + 1})}</span>
                <span className="text-[17px]">{t(`stages.${stage}`)}</span>
                <span className="text-[12px] opacity-72">{t(`stageNotes.${stage}`)}</span>
              </li>
            );
          })}
        </ol>
        {!signedIn && (
          <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-body-sm">
            <span className="text-text-secondary">
              <span className={cn(LABEL, 'mr-3 text-text-muted')}>{t('confirmation.status')}</span>
              {tOr(t, `fulfillment.${order.fulfillment.toLowerCase()}`, order.fulfillment)}
            </span>
            {order.tracking && (
              <span className="text-text-secondary">
                <span className={cn(LABEL, 'mr-3 text-text-muted')}>{t('confirmation.tracking')}</span>
                {dotJoin(order.carrier, order.tracking)}
              </span>
            )}
            {trackingUrl && (
              <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="self-start">
                {t('confirmation.trackParcel')}
              </a>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-12 px-6 pt-14 pb-24 md:px-12 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-w-0 flex-col gap-6">
          <h2 className="m-0 font-display text-display-4 font-normal">{t('confirmation.whatYouOrdered')}</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {order.items.map(l => {
              const link = l.productId ? productLink(l.productId, locale) : null;
              return (
                <li
                  key={l.lineId}
                  className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-start gap-5 border-b border-hairline py-[22px] md:grid-cols-[88px_minmax(0,1fr)_auto]">
                  {link ? (
                    <a href={link} aria-label={l.name} className="block border-0">
                      <Img photo={l.image} alt={l.name} width={220} media={false} />
                    </a>
                  ) : (
                    <Img photo={l.image} alt={l.name} width={220} media={false} />
                  )}
                  <div className="flex min-w-0 flex-col gap-2">
                    {link ? (
                      <a href={link} className="self-start border-0 font-display text-[22px] leading-display text-text-primary">
                        {l.name}
                      </a>
                    ) : (
                      <span className="self-start font-display text-[22px] leading-display text-text-primary">{l.name}</span>
                    )}
                    <span className="text-body-xs text-text-muted">{lineMeta(l, tc)}</span>
                    <span className="text-[12px] text-text-muted">{t('sku', {sku: l.sku})}</span>
                    {l.discount > 0 && <LineDiscountNote>{lineDiscountNote(l, discounts, tc, m)}</LineDiscountNote>}
                    {l.digital && l.download && (
                      <a
                        href={downloadHref(l.download, order.number, guestEmail)}
                        download
                        className={cn(OUTLINE_CTA, 'mt-1 self-start px-4 py-2.5')}>
                        {t('confirmation.downloadPdf')}
                      </a>
                    )}
                  </div>
                  <LinePrice total={l.total} discount={l.discount} className="text-[15px]" />
                </li>
              );
            })}
          </ul>
          <p className="m-0 max-w-[60ch] text-body-xs text-text-muted">{t('confirmation.shipsNote')}</p>
        </section>

        <aside className="flex flex-col gap-7">
          <div className="flex flex-col gap-3.5 border border-hairline p-7">
            <h2 className={cn(LABEL_HEADING, 'text-text-primary')}>{t('confirmation.payment')}</h2>
            <TotalsTable
              className="gap-2.5"
              subtotal={order.subtotal}
              discount={order.discount}
              discountCode={order.discountCode}
              discounts={discounts}
              shippingLabel={shippingLabel}
              tax={order.tax}
              taxName={taxName}
              taxRate={taxRate}
              pricesIncludeTax={order.pricesIncludeTax}
              physical={!!a}>
              <div className="mt-1 flex justify-between gap-4 border-t border-strong pt-3">
                <span>{t('confirmation.totalPaid')}</span>
                <span className="text-[18px]">{total}</span>
              </div>
              <SavingsLine amount={order.discount} className="self-end" />
            </TotalsTable>
            <span className={cn(LABEL, 'text-[12px]', order.payment === 'Paid' ? 'text-signal-positive' : 'text-text-muted')}>
              {order.cardLast4 ? t('confirmation.cardEnding', {status: payment, last4: order.cardLast4}) : payment}
            </span>
          </div>
          {addressBlock ? (
            <div className="flex flex-col gap-3 border border-hairline p-7">
              <h2 className={cn(LABEL_HEADING, 'text-text-primary')}>{t('confirmation.shippingTo')}</h2>
              <span className="text-body-sm leading-body text-text-secondary">{addressBlock}</span>
              <span className="text-body-xs text-text-muted">
                {dotJoin(order.method, order.shipping === 0 && t('confirmation.complimentary'))}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3 border border-hairline p-7">
              <h2 className={cn(LABEL_HEADING, 'text-text-primary')}>{t('confirmation.delivery')}</h2>
              <span className="text-body-xs text-text-muted">{order.method}</span>
            </div>
          )}
          <div className="flex flex-col gap-3 border border-hairline p-7">
            <h2 className={cn(LABEL_HEADING, 'text-text-primary')}>{t('confirmation.needSomething')}</h2>
            <a href={returnsLink(order.number, locale)} className="self-start text-body-sm">
              {t('returnsRefunds')}
            </a>
            <a href={href('/contact/', locale)} className="self-start text-body-sm">
              {t('contactStudio')}
            </a>
            {signedIn && (
              <a href={href('/account/orders/', locale)} className="self-start text-body-sm">
                {t('allOrders')}
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Fact({label, value}: {label: string; value: string}) {
  return (
    <span className="flex flex-col gap-1.5">
      <span className={cn(LABEL, 'text-text-muted')}>{label}</span>
      <span className="text-[18px]">{value}</span>
    </span>
  );
}
