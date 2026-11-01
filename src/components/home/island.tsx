/*
 * What every home component receives from src/pages/index.astro: the page language, the word catalogs it
 * renders (built on the server with `dictsFor`, only the keys it needs) and the store currency. Plain JSON,
 * so the same props serve server-only components and `client:visible` islands.
 */
import type {ReactNode} from 'react';

import {type Dicts, TextProvider} from '@/components/varel/text';
import {money, priceText} from '@/lib/format';

export interface HomeProps {
  locale: string;
  dicts: Dicts;
  /** ISO 4217 store currency (PublicSettings.currency) */
  currency?: string;
}

/** Wrap a home component's tree so `useText(ns)` reads the page's catalogs. */
export function HomeText({locale, dicts, children}: HomeProps & {children: ReactNode}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      {children}
    </TextProvider>
  );
}

/** Price strings in the store currency, independent of any module-level money state. */
export function priceOf(p: {price: number; compareAt: number | null}, currency: string | undefined, locale: string) {
  return {
    price: priceText(p.price, locale, currency),
    compareAt: p.compareAt ? money(p.compareAt, currency, locale) : undefined,
  };
}
