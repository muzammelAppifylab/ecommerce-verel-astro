/* Printable invoice for one order (VAREL src/pages/account/Invoice.tsx). Rendered into <body> as #invoice-print and
   hidden on screen; while it is mounted, printing shows only this document (./invoice.css), so "Download invoice"
   → Save as PDF gives an A4 invoice instead of a copy of the page. */
import './invoice.css';

import {useQuery} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';

import {formatDateLong, minusMoney, money} from '@/lib/format';
import type {TFunction} from '@/lib/i18n';
import type {Order} from '@/lib/types/orders';

import {countryName} from './_shared/countries';
import {appliedDiscounts, merchandiseDiscounts} from './_shared/discounts';
import {useOrdersLocale, useOrdersT} from './host';
import {taxPercent} from './order-utils';
import {publicSettingsQuery} from './queries';

const label = 'text-[8pt] tracking-[0.12em] uppercase text-ink-500';

/** The store name for the invoice and its file name ("VAREL" until the settings answer). */
export function useStoreName(): string {
  const s = useQuery(publicSettingsQuery()).data;
  return s?.storeName || 'VAREL';
}

/** Print the invoice; the document title becomes the suggested PDF file name ("VAREL invoice VRL-24932"). */
export function printInvoice(t: TFunction, number: string, store: string) {
  const title = document.title;
  document.title = t('invoice.documentTitle', {store, number});
  window.addEventListener('afterprint', () => (document.title = title), {once: true});
  window.print();
}

export function Invoice({order: o}: {order: Order}) {
  const t = useOrdersT('orders');
  const locale = useOrdersLocale();
  const s = useQuery(publicSettingsQuery()).data;
  // The portal target exists only in the browser (the screens are client-rendered, but keep SSR safe).
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  if (!body) return null;

  const cur = o.currency;
  const m = (n: number) => money(n, cur, locale);
  const store = s?.storeName || 'VAREL';
  const rate = taxPercent(o.taxRate);
  const discounts = merchandiseDiscounts(appliedDiscounts(o, t));
  const address = o.address
    ? [o.address.name, o.address.line1, o.address.line2, `${o.address.zip} ${o.address.city}`.trim(), countryName(o.address.country, locale)].filter(
        (l): l is string => !!l
      )
    : [];
  const card = o.cardLast4
    ? o.cardBrand
      ? t('details.brandEnding', {brand: o.cardBrand, last4: o.cardLast4})
      : t('details.ending', {last4: o.cardLast4})
    : null;

  return createPortal(
    <article id="invoice-print" aria-hidden className="hidden bg-white text-[9.5pt] leading-[1.45] text-ink-900 print:block">
      {/* Masthead */}
      <header className="flex items-start justify-between gap-8 border-b border-ink-900 pb-6">
        <div>
          <p className="m-0 text-[20pt] leading-none font-light tracking-[0.42em]">{store.toUpperCase()}</p>
          <div className="mt-4 flex flex-col text-ink-700">
            {s?.legalName && <span>{s.legalName}</span>}
            {s?.businessAddress && <span className="whitespace-pre-line">{s.businessAddress}</span>}
            {s?.vatNumber && <span>{t('invoice.vatNumber', {number: s.vatNumber})}</span>}
            {s?.supportEmail && <span>{s.supportEmail}</span>}
          </div>
        </div>
        <div className="text-right">
          <h2 className="m-0 font-display text-[24pt] leading-none font-normal">{t('invoice.title')}</h2>
          <dl className="mt-4 grid grid-cols-[auto_auto] justify-end gap-x-5 gap-y-0.5">
            <dt className="text-ink-500">{t('invoice.number')}</dt>
            <dd className="m-0">{o.number}</dd>
            <dt className="text-ink-500">{t('invoice.date')}</dt>
            <dd className="m-0">{formatDateLong(o.placedAt, locale)}</dd>
            <dt className="text-ink-500">{t('invoice.payment')}</dt>
            <dd className="m-0">{t(`payment.${o.payment.toLowerCase()}`, {defaultValue: o.payment})}</dd>
          </dl>
        </div>
      </header>

      {/* Parties */}
      <section className="grid grid-cols-2 gap-8 border-b border-ink-200 py-6">
        <div>
          <p className={label}>{t('invoice.billedTo')}</p>
          <div className="mt-2 flex flex-col">
            {o.billingSameAsShipping && address.length ? address.map(l => <span key={l}>{l}</span>) : <span>{o.address?.name}</span>}
            <span>{o.email}</span>
            {o.phone && <span>{o.phone}</span>}
          </div>
        </div>
        <div>
          <p className={label}>{t('invoice.shipTo')}</p>
          <div className="mt-2 flex flex-col">
            {address.length ? address.map(l => <span key={l}>{l}</span>) : <span>{t('noShippingDigital')}</span>}
            {o.address && <span className="mt-1 text-ink-500">{o.method}</span>}
          </div>
        </div>
      </section>

      {/* Lines */}
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-ink-900 text-left">
            <th className={`${label} pb-2 font-normal`}>{t('invoice.columns.item')}</th>
            <th className={`${label} pb-2 text-right font-normal`}>{t('invoice.columns.qty')}</th>
            <th className={`${label} pb-2 text-right font-normal`}>{t('invoice.columns.unitPrice')}</th>
            <th className={`${label} pb-2 text-right font-normal`}>{t('invoice.columns.discount')}</th>
            <th className={`${label} pb-2 text-right font-normal`}>{t('invoice.columns.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map(l => (
            <tr key={l.lineId} className="break-inside-avoid border-b border-ink-200 align-top">
              <td className="py-3 pr-4">
                <span className="block">{l.name}</span>
                <span className="block text-[8.5pt] text-ink-500">
                  {[l.color, l.size, ...Object.values(l.options ?? {}), l.digital && t('details.digitalProduct'), t('sku', {sku: l.sku})]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </td>
              <td className="py-3 text-right tabular-nums">{l.qty}</td>
              <td className="py-3 text-right tabular-nums">{m(l.price)}</td>
              <td className="py-3 text-right tabular-nums">{l.discount > 0 ? minusMoney(l.discount, cur, locale) : '—'}</td>
              <td className="py-3 text-right tabular-nums">{m(Math.round((l.total - l.discount) * 100) / 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-6 flex justify-between gap-10">
        <div className="max-w-[46%] self-end text-ink-700">
          {card && <p className="m-0">{t('invoice.paidWith', {card})}</p>}
          {o.payment === 'Refunded' && <p className="m-0 mt-1">{t('invoice.refunded')}</p>}
        </div>
        <dl className="m-0 grid w-[46%] grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
          <dt className="text-ink-700">{t('details.subtotal')}</dt>
          <dd className="m-0 text-right">{m(o.subtotal)}</dd>
          {discounts.map(d => (
            <div key={d.id + d.label} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-ink-700">{d.label}</dt>
              <dd className="m-0 text-right">{minusMoney(d.amount, cur, locale)}</dd>
            </div>
          ))}
          <dt className="text-ink-700">{o.address ? t('details.shippingWith', {method: o.method}) : t('noShippingDigital')}</dt>
          <dd className="m-0 text-right">{o.shipping === 0 ? t('free') : m(o.shipping)}</dd>
          {!o.pricesIncludeTax && (
            <>
              <dt className="text-ink-700">{t('details.vat', {rate})}</dt>
              <dd className="m-0 text-right">{m(o.tax)}</dd>
            </>
          )}
          <div className="col-span-2 mt-2 flex justify-between border-t border-ink-900 pt-2 text-[11pt]">
            <dt>{t('details.total')}</dt>
            <dd className="m-0 text-right">{m(o.total)}</dd>
          </div>
          {o.pricesIncludeTax && (
            <>
              <dt className="text-ink-500">{t('details.includesVat', {rate})}</dt>
              <dd className="m-0 text-right text-ink-500">{m(o.tax)}</dd>
            </>
          )}
        </dl>
      </section>

      <footer className="mt-12 border-t border-ink-200 pt-4 text-[8.5pt] text-ink-500">
        {t('invoice.footer', {store, email: s?.supportEmail || 'care@varel.studio'})}
      </footer>
    </article>,
    body
  );
}
