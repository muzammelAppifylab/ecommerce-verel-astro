/*
 * Money for the bag islands: F2's `money()` (src/components/varel/support.ts) knows the store currency and the
 * page language on the server (Storefront.astro sets it per render) and in the browser (read from
 * `data-store-currency` and `<html lang>`), so the amounts match the rest of the storefront.
 * Amounts are currency units, as the API sends them (VAREL src/lib/format.ts `money`, `priceText`, `minusMoney`).
 */
import {money as storeMoney} from '@/components/varel/support';

/** "Free" in each shipped language (common:free), so a price of 0 needs no dictionary. */
const FREE: Record<string, string> = {en: 'Free', da: 'Gratis', de: 'Kostenlos', fr: 'Offert', es: 'Gratis', sv: 'Gratis'};

/** `$148`, `$24.60`, `148 kr.` (whole amounts without decimals). */
export const money = (n: number | string): string => storeMoney(Number(Number(n).toFixed(2)));

/** Like `money()` but 0 reads "Free" in the page language. */
export const priceText = (n: number, locale = 'en'): string => (n === 0 ? (FREE[locale] ?? FREE.en) : money(n));

/** Negative amount for discount rows: `−$14.80` (true minus sign, as in the prototype). */
export const minusMoney = (n: number): string => '−' + money(n);
