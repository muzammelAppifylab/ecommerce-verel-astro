/* Money for the checkout display components. VAREL's `money()` read one global currency; here the currency is
   explicit wherever it is known (the store currency on /checkout/, `order.currency` on the confirmation), carried
   by <CurrencyProvider>, and the language comes from the nearest <TextProvider>. Without a provider, the storefront
   default applies (`money()` from the design system: the page's `data-store-currency`). Never mutates module state,
   so concurrent server renders in different currencies or languages cannot interleave. */
import {createContext, type ReactNode, useContext, useMemo} from 'react';

import {useLocale} from '@/components/varel/text';
import {money as storeMoney} from '@/components/varel/support';
import {money as formatMoney, priceText as formatPrice} from '@/lib/format';

export interface MoneyFormat {
  /** `$148`, `$24.60`, `148 kr.` */
  money(n: number | string): string;
  /** `−$14.80` (true minus sign) */
  minus(n: number): string;
  /** Like `money` but 0 reads "Free" (in the page language) */
  price(n: number): string;
}

const CurrencyContext = createContext<string | null>(null);

/** `<CurrencyProvider currency="DKK">…</CurrencyProvider>` around display components with a known currency. */
export function CurrencyProvider({currency, children}: {currency?: string | null; children: ReactNode}) {
  return <CurrencyContext.Provider value={currency?.trim().toUpperCase() || null}>{children}</CurrencyContext.Provider>;
}

/** A formatter for one currency (null: the storefront default) and language. */
export function moneyFormat(currency: string | null | undefined, locale: string): MoneyFormat {
  const fmt = (n: number | string) => (currency ? formatMoney(n, currency, locale) : storeMoney(n));
  return {
    money: fmt,
    minus: n => '−' + fmt(Number(Number(n).toFixed(2))),
    price: n => (n === 0 ? formatPrice(0, locale) : fmt(n)),
  };
}

/** `const m = useMoney(); m.money(148)` in the provider's currency and the page language. */
export function useMoney(): MoneyFormat {
  const currency = useContext(CurrencyContext);
  const locale = useLocale();
  return useMemo(() => moneyFormat(currency, locale), [currency, locale]);
}
