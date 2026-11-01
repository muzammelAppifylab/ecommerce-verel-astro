/* Stripe amounts in the currency's minor unit (zero- and three-decimal currencies per Stripe's docs). */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** 148.5 USD → 14850; 1500 JPY → 1500; 1.234 KWD → 1230 (Stripe rounds three-decimal amounts to tens). */
export function toMinor(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return Math.round(amount);
  if (THREE_DECIMAL.has(c)) return Math.round(amount * 100) * 10;
  return Math.round(amount * 100);
}
