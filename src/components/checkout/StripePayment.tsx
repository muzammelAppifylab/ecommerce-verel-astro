/* Stripe Payment Element in VAREL dress (port of VAREL src/pages/checkout/StripePayment.tsx), on vanilla
   @stripe/stripe-js (no @stripe/react-stripe-js here). Loaded with a dynamic import() only when Stripe is the active
   provider, so the simulated checkout never downloads Stripe.js. Deferred-intent mode: the element renders with the
   bag amount, `submit()` validates it before the order is placed, `confirm()` pays the PaymentIntent the order
   created. The page opens Stripe's hosts in its own CSP (allowEmbeddedCheckout on /checkout/ only). */
import type {Appearance, Stripe, StripeElements, StripeElementsOptions, StripePaymentElement} from '@stripe/stripe-js';
import {type Ref, useEffect, useImperativeHandle, useRef, useState} from 'react';

import {Spinner} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';

import {toMinor} from './stripe-amount';

export interface StripePaymentHandle {
  /** Validate what was entered. Returns a message to show, or null when it is complete. */
  submit(): Promise<string | null>;
  /** Pay the order's PaymentIntent. Redirects only for methods that need it (bank pages). */
  confirm(
    clientSecret: string,
    returnUrl: string,
    billing: {name?: string; email: string; phone?: string}
  ): Promise<{error: string | null; status: string | null}>;
}

interface Props {
  publishableKey: string;
  amount: number; // major units
  currency: string; // ISO 4217
  handleRef: Ref<StripePaymentHandle>;
}

const loaders = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  let p = loaders.get(key);
  if (!p) {
    // Importing @stripe/stripe-js injects Stripe.js: only here, only when Stripe is the provider.
    p = import('@stripe/stripe-js').then(m => m.loadStripe(key));
    loaders.set(key, p);
  }
  return p;
};

const INK = {900: '#1A1A1A', 700: '#3D3D3D', 500: '#6E6E6E', 400: '#8C8C8C', 200: '#D9D9D9', 100: '#E8E8E8', 0: '#FFFFFF'};
const CRITICAL = '#8A3A2E';

const appearance: Appearance = {
  theme: 'flat',
  labels: 'above',
  variables: {
    fontFamily: 'Lato, "Helvetica Neue", Arial, sans-serif',
    fontWeightLight: '300',
    fontWeightNormal: '300',
    fontWeightMedium: '400',
    fontSizeBase: '15px',
    borderRadius: '0px',
    colorPrimary: INK[900],
    colorText: INK[900],
    colorTextSecondary: INK[500],
    colorTextPlaceholder: INK[400],
    colorBackground: INK[0],
    colorDanger: CRITICAL,
    colorIcon: INK[500],
    spacingUnit: '4px',
    gridRowSpacing: '24px',
    gridColumnSpacing: '24px',
    focusBoxShadow: 'none',
    focusOutline: 'none',
  },
  rules: {
    '.Label': {
      fontSize: '12px',
      fontWeight: '400',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: INK[500],
      marginBottom: '8px',
    },
    '.Input': {
      border: 'none',
      borderBottom: `1px solid ${INK[200]}`,
      borderRadius: '0px',
      boxShadow: 'none',
      backgroundColor: 'transparent',
      padding: '12px 0',
      fontWeight: '300',
    },
    '.Input:focus': {borderBottom: `1px solid ${INK[900]}`, boxShadow: 'none'},
    '.Input--invalid': {borderBottom: `1px solid ${CRITICAL}`, boxShadow: 'none', color: INK[900]},
    '.Error': {fontSize: '12px', marginTop: '6px'},
    '.Tab': {border: `1px solid ${INK[200]}`, borderRadius: '0px', boxShadow: 'none', backgroundColor: INK[0]},
    '.Tab:hover': {border: `1px solid ${INK[400]}`, color: INK[900]},
    '.Tab--selected, .Tab--selected:hover, .Tab--selected:focus': {
      border: `1px solid ${INK[900]}`,
      backgroundColor: INK[900],
      color: INK[0],
      boxShadow: 'none',
    },
    '.TabIcon--selected': {fill: INK[0]},
    '.TabLabel': {fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: '400'},
    '.AccordionItem': {border: `1px solid ${INK[200]}`, borderRadius: '0px', boxShadow: 'none'},
    '.Block': {borderRadius: '0px', boxShadow: 'none', border: `1px solid ${INK[200]}`},
    '.CheckboxInput': {borderRadius: '0px'},
  },
};

export default function StripePayment({publishableKey, amount, currency, handleRef}: Props) {
  const t = useText('checkout');
  const locale = useLocale();
  const minor = toMinor(amount, currency);
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The Elements options are read once (the first amount); later amounts go through elements.update.
  const initial = useRef({minor, currency, locale});

  useEffect(() => {
    let live = true;
    let element: StripePaymentElement | null = null;
    stripeFor(publishableKey)
      .then(stripe => {
        if (!live) return;
        if (!stripe || !mountRef.current) {
          setLoadError(t('errors.paymentLoad'));
          return;
        }
        const opts: StripeElementsOptions = {
          mode: 'payment',
          amount: Math.max(initial.current.minor, 1),
          currency: initial.current.currency.toLowerCase(),
          appearance,
          fonts: [{cssSrc: 'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap'}],
          loader: 'never',
          // Payment Element in the storefront language
          locale: initial.current.locale as StripeElementsOptions['locale'],
        };
        const els = stripe.elements(opts);
        element = els.create('payment', {layout: {type: 'tabs'}, fields: {billingDetails: {email: 'never'}}});
        element.on('ready', () => live && setReady(true));
        element.on('loaderror', e =>
          live &&
          setLoadError(e.error?.message ? t('errors.paymentLoadDetail', {message: e.error.message}) : t('errors.paymentLoad'))
        );
        element.mount(mountRef.current);
        stripeRef.current = stripe;
        setElements(els);
      })
      .catch(() => live && setLoadError(t('errors.paymentLoad')));
    return () => {
      live = false;
      element?.destroy();
      stripeRef.current = null;
      setElements(null);
    };
    // One element per key; words and amount changes do not remount it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishableKey]);

  useEffect(() => {
    if (elements && minor > 0) elements.update({amount: minor});
  }, [elements, minor]);

  useImperativeHandle(
    handleRef,
    () => ({
      async submit() {
        const stripe = stripeRef.current;
        if (!stripe || !elements) return t('errors.paymentLoading');
        const {error} = await elements.submit();
        return error ? (error.message ?? t('errors.checkPayment')) : null;
      },
      async confirm(clientSecret, returnUrl, billing) {
        const stripe = stripeRef.current;
        if (!stripe || !elements) return {error: t('errors.paymentLoading'), status: null};
        const {error, paymentIntent} = await stripe.confirmPayment({
          elements,
          clientSecret,
          redirect: 'if_required',
          confirmParams: {
            return_url: returnUrl,
            payment_method_data: {
              billing_details: {name: billing.name || undefined, email: billing.email, phone: billing.phone || undefined},
            },
          },
        });
        if (error) return {error: error.message ?? t('errors.paymentFailed'), status: error.payment_intent?.status ?? null};
        return {error: null, status: paymentIntent?.status ?? null};
      },
    }),
    [elements, t]
  );

  return (
    <div className="relative min-h-[120px]">
      {!ready && !loadError && (
        <div className="absolute inset-0 flex items-center gap-3 text-body-sm text-text-muted">
          <Spinner size={14} /> {t('loadingSecure')}
        </div>
      )}
      {loadError && (
        <p role="alert" className="m-0 text-body-xs text-signal-critical">
          {loadError}
        </p>
      )}
      <div ref={mountRef} className={ready ? undefined : 'opacity-0'} />
    </div>
  );
}
