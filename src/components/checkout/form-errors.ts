/* Checkout form errors (pulled out of VAREL src/pages/Checkout.tsx so they are unit-testable). */
import type {AddressErrors, AddressState} from './address';
import type {CardErrors, CardState} from './card';

export interface Errors {
  email?: string;
  phone?: string;
  shipping: AddressErrors;
  billing: AddressErrors;
  method?: string;
  card: CardErrors;
  note?: string;
  terms?: string;
  form?: string;
}

export const NO_ERRORS: Errors = {shipping: {}, billing: {}, card: {}};

/** Maps API `fields` keys ("shippingAddress.city", "payment.number" …) onto form errors. */
export function mapApiFields(fields: Record<string, string>): Errors {
  const e: Errors = {shipping: {}, billing: {}, card: {}};
  for (const [key, msg] of Object.entries(fields)) {
    const [head, sub] = key.split('.');
    if (head === 'email') e.email = msg;
    else if (head === 'phone') e.phone = msg;
    else if (head === 'shippingMethodId') e.method = msg;
    else if (head === 'customerNote') e.note = msg;
    else if (head === 'acceptTerms') e.terms = msg;
    else if (head === 'shippingAddress') {
      if (sub) e.shipping[sub as keyof AddressState] = msg;
      else e.form = msg;
    } else if (head === 'billingAddress') {
      if (sub) e.billing[sub as keyof AddressState] = msg;
      else e.form = msg;
    } else if (head === 'payment' && sub) e.card[sub as keyof CardState] = msg;
    else e.form = msg;
  }
  return e;
}

/** Fields with a message (the form-level message is shown on its own). */
export const errorCount = (e: Errors) =>
  [e.email, e.phone, e.method, e.note, e.terms].filter(Boolean).length +
  [e.shipping, e.billing, e.card].reduce((n, g) => n + Object.values(g).filter(Boolean).length, 0);

export const hasErrors = (e: Errors) =>
  !!(e.email || e.phone || e.method || e.note || e.terms || e.form) ||
  Object.keys(e.shipping).length > 0 ||
  Object.keys(e.billing).length > 0 ||
  Object.keys(e.card).length > 0;

/** Focus the first field with an error, centred so its message is in view. */
export const focusFirstInvalid = () =>
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('form [aria-invalid="true"]');
    el?.focus({preventScroll: true});
    el?.scrollIntoView({block: 'center', behavior: 'smooth'});
  });
