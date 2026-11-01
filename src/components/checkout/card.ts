/* Card field formatting + client-side checks (port of VAREL src/pages/checkout/card.ts). The server re-validates
   everything (Luhn, expiry, CVC). Used only for the simulated provider: Stripe collects cards in its own element. */
import type {Translate} from '@/components/varel/text';

const digits = (s: string) => s.replace(/\D/g, '');

/** "4242424242424242" → "4242 4242 4242 4242" (max 19 digits). */
export function formatCardNumber(v: string): string {
  return digits(v)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** "0929" → "09 / 29" (matches the prototype placeholder). */
export function formatExpiry(v: string): string {
  let d = digits(v).slice(0, 4);
  if (d.length === 1 && Number(d) > 1) d = '0' + d;
  return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
}

export function formatCvc(v: string): string {
  return digits(v).slice(0, 4);
}

export function luhn(num: string): boolean {
  const n = digits(num);
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = n.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function expiryValid(v: string, now = new Date()): boolean {
  const m = /^(\d{2}) \/ (\d{2})$/.exec(v.trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  return new Date(year, month, 1).getTime() > now.getTime();
}

export interface CardState {
  name: string;
  number: string;
  expiry: string;
  cvc: string;
}

export type CardErrors = Partial<Record<keyof CardState, string>>;

/** Field → message, using the API's wording. `t` is the `checkout` namespace translator. */
export function validateCard(c: CardState, t: Translate, now = new Date()): CardErrors {
  const e: CardErrors = {};
  const msg = (key: string) => t(`errors.${key}`);
  if (!c.name.trim()) e.name = msg('cardName');
  if (!digits(c.number)) e.number = msg('cardNumber');
  else if (!luhn(c.number)) e.number = msg('cardCheck');
  if (!c.expiry.trim()) e.expiry = msg('expiry');
  else if (!expiryValid(c.expiry, now)) e.expiry = msg('expiryPast');
  if (!/^\d{3,4}$/.test(c.cvc.trim())) e.cvc = msg('cvc');
  return e;
}
