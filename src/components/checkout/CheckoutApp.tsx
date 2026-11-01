/* The checkout island (port of VAREL src/pages/Checkout.tsx): contact, shipping address and method, payment
   (Stripe Payment Element or the simulated card form), billing, note, terms, and the order summary aside.
   The page (src/pages/checkout/index.astro) reads the bag, rules, provider, countries, the first shipping methods
   and the signed-in customer's details on the server and hands them in as props; the guards that VAREL ran in the
   component (bag loading, bag empty, sign-in required) run there. Live data that VAREL kept in React Query
   (totals, methods, the bag after a code change) is local state refreshed through ./checkout-api. */
import {navigate} from 'astro:transitions/client';
import {type FormEvent, lazy, Suspense, useEffect, useRef, useState} from 'react';

import {Checkbox, Icon, Input, Select, Spinner, Textarea} from '@/components/varel';
import {type Dicts, TextProvider, useLocale, useText} from '@/components/varel/text';
import {cartLink, checkoutLink, confirmationLink, loginLink} from '@/lib/links';
import {bag} from '@/lib/stores/bag';
import {errorMessage, isApiError} from '@/lib/storefront-api';
import type {Address} from '@/lib/types/account';
import type {Cart, Totals} from '@/lib/types/cart';
import type {CheckoutConfig, CheckoutRequest, Order, ShippingMethod, ShippingMethodsResponse} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {AddressFields} from './AddressFields';
import {type AddressState, EMPTY_ADDRESS, toAddressState, toApiAddress, validateAddress} from './address';
import {formatCardNumber, formatCvc, formatExpiry, validateCard, type CardState} from './card';
import {cancelOrderPayment, captureCartEmail, getCart, getShippingMethods, getTotals, placeOrder, removeDiscount} from './checkout-api';
import {countryName} from './countries';
import {isCustomerDiscountError, RemoveCodeButton} from './discounts';
import {errorCount, type Errors, focusFirstInvalid, hasErrors, mapApiFields, NO_ERRORS} from './form-errors';
import {CurrencyProvider, useMoney} from './money';
import {OrderSummary} from './OrderSummary';
import type {StripePaymentHandle} from './StripePayment';
import {LABEL, LABEL_HEADING} from './ui';

// Stripe.js only loads when Stripe is the active provider.
const StripePayment = lazy(() => import('./StripePayment'));
const NOTE_MAX = 500;

const EMAIL_RE = /.+@.+\..+/;
const PAYMENTS = ['Card', 'MobilePay', 'PayPal'] as const;
const STEPS = ['information', 'shipping', 'payment'] as const;

/** The store's checkout rules (PublicSettings). */
export interface CheckoutRules {
  guestCheckout: boolean;
  requirePhone: boolean;
  orderNotes: boolean;
  termsText: string;
  returnWindowDays: number;
}

export interface CheckoutAppProps {
  cart: Cart;
  /** Methods for `initialCountry`, read on the server (null: digital-only bag, or the read failed) */
  initialMethods: ShippingMethodsResponse | null;
  initialCountry: string;
  /** English country names, home country first (GET /site-api/countries) */
  countries: string[];
  rules: CheckoutRules;
  /** The active payment provider (null: unknown, the simulated card form is shown) */
  config: CheckoutConfig | null;
  /** Store currency (ISO 4217) */
  currency: string;
  locale: string;
  dicts: Dicts;
  /** The signed-in customer, null for guests */
  user: {email: string; name: string; phone: string | null} | null;
  /** The signed-in customer's saved addresses */
  addresses: Address[];
}

export default function CheckoutApp(props: CheckoutAppProps) {
  return (
    <TextProvider locale={props.locale} dicts={props.dicts}>
      <CurrencyProvider currency={props.currency}>
        <Checkout {...props} />
      </CurrencyProvider>
    </TextProvider>
  );
}

type MethodsState = {status: 'idle' | 'loading' | 'ready' | 'error'; zone: string | null; methods: ShippingMethod[]; error?: string};

function Checkout({cart: initialCart, initialMethods, initialCountry, countries, rules, config, user, addresses}: CheckoutAppProps) {
  const t = useText('checkout');
  const locale = useLocale();
  const m = useMoney();
  const guestPhone = rules.requirePhone;
  const {orderNotes} = rules;
  const termsText = rules.termsText?.trim() ?? '';

  const [cart, setCart] = useState<Cart>(initialCart);
  const digitalOnly = cart.lines.length > 0 && cart.lines.every(l => l.digital);

  // Prefill (signed in): contact + the primary saved address, once, as the initial state.
  const primary = addresses.find(a => a.primary) ?? addresses[0];
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone || primary?.phone || '');
  const [ship, setShip] = useState<AddressState>(() =>
    primary ? toAddressState(primary) : {...EMPTY_ADDRESS, country: initialCountry, name: user?.name ?? ''}
  );
  const [savedId, setSavedId] = useState<string>(primary?.id ?? '');
  const [methodId, setMethodId] = useState<string | null>(initialMethods?.methods[0]?.id ?? null);
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]>('Card');
  const [card, setCard] = useState<CardState>({name: user?.name ?? '', number: '', expiry: '', cvc: ''});
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState<AddressState>({...EMPTY_ADDRESS, country: initialCountry});
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [emailTouched, setEmailTouched] = useState(false);
  // The email the totals are priced for (set once it's complete: on blur, prefill and submit), so offers limited to
  // first orders or per customer show as checkout will charge them.
  const [pricedEmail, setPricedEmail] = useState(user?.email.trim().toLowerCase() ?? '');
  const [note, setNote] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  // True from submit until the payment has an outcome (order placed, Stripe confirming, redirecting).
  const [busy, setBusy] = useState(false);
  const [signInNeeded, setSignInNeeded] = useState(false);
  const stripeRef = useRef<StripePaymentHandle>(null);
  const captured = useRef('');
  // A code that failed a customer-dependent check at checkout (not eligible, limit reached, used up).
  const [codeError, setCodeError] = useState<{code: string; message: string} | null>(null);
  const [removingCode, setRemovingCode] = useState(false);
  const placed = useRef(false);

  // Shipping methods by zone for the chosen country (the server read the first country's).
  const [methodsState, setMethodsState] = useState<MethodsState>(() =>
    initialMethods
      ? {status: 'ready', zone: initialMethods.zone, methods: initialMethods.methods}
      : {status: digitalOnly ? 'idle' : 'loading', zone: null, methods: []}
  );
  const methodsFor = useRef<string | null>(initialMethods ? initialCountry : null);
  useEffect(() => {
    if (digitalOnly || !ship.country) return;
    if (methodsFor.current === ship.country) return;
    methodsFor.current = ship.country;
    const ctrl = new AbortController();
    setMethodsState(s => ({...s, status: 'loading', error: undefined}));
    getShippingMethods(ship.country, ctrl.signal)
      .then(res => setMethodsState({status: 'ready', zone: res.zone, methods: res.methods}))
      .catch(err => {
        if ((err as Error)?.name === 'AbortError') return;
        methodsFor.current = null;
        setMethodsState({status: 'error', zone: null, methods: [], error: errorMessage(err)});
      });
    return () => ctrl.abort();
  }, [ship.country, digitalOnly]);
  const methods = methodsState.methods;
  useEffect(() => {
    if (!methods.length) return;
    setMethodId(id => (id && methods.some(x => x.id === id) ? id : methods[0].id));
    setErrors(x => (x.method ? {...x, method: undefined} : x));
  }, [methods]);
  const chosen = methods.find(x => x.id === methodId);

  // Once the failing code leaves the bag (from any remove control, or a new code), clear its message.
  const storedCode = cart.discountCode ?? null;
  const failedCode = useRef<string | null>(null);
  useEffect(() => {
    if (!codeError) return;
    if (failedCode.current === null) failedCode.current = storedCode;
    else if (storedCode !== failedCode.current) {
      failedCode.current = null;
      setCodeError(null);
      setErrors(x => ({...x, form: undefined}));
    }
  }, [codeError, storedCode]);

  // Live totals from the server for the country, method and email; the last settled answer stays on screen while
  // the next one loads. `version` re-reads them after the bag changed (code applied or removed, prices moved).
  const [live, setLive] = useState<Totals | null>(null);
  const [version, setVersion] = useState(0);
  const totalsCountry = ship.country || undefined;
  const totalsMethod = digitalOnly ? null : (chosen?.id ?? null);
  useEffect(() => {
    const ctrl = new AbortController();
    getTotals({country: totalsCountry, method: totalsMethod, email: pricedEmail || undefined}, ctrl.signal)
      .then(setLive)
      .catch(() => undefined); // keep the last totals
    return () => ctrl.abort();
  }, [totalsCountry, totalsMethod, pricedEmail, version]);
  const totals: Totals = live ?? cart.totals;

  /** Re-read the bag (after an error that may have changed it). An emptied bag goes back to /cart/. */
  const refreshCart = async () => {
    try {
      const next = await getCart();
      bag.applyCart(next);
      if (next.lines.length === 0 && !placed.current) {
        navigate(cartLink(locale), {history: 'replace'});
        return;
      }
      setCart(next);
    } catch {
      /* keep what is on screen */
    }
    setVersion(v => v + 1);
  };
  const onCart = (next: Cart) => {
    setCart(next);
    setVersion(v => v + 1);
  };

  const contactValid = EMAIL_RE.test(email.trim());
  const addressValid = digitalOnly || Object.keys(validateAddress(ship, t)).length === 0;
  const shippingValid = digitalOnly || !!chosen;
  const activeStep = !contactValid || !addressValid ? 0 : !shippingValid ? 1 : 2;

  const methodLabel = digitalOnly ? t('methodDigital') : chosen ? chosen.name.toLowerCase() : '—';
  const totalLabel = m.money(Number(totals.total.toFixed(2)));
  const zoneLabel = methodsState.zone;
  // Card fields are only needed (and validated server side) when something is charged.
  const charge = (totals.total ?? 1) > 0;
  // Stripe collects the card in its Payment Element; otherwise the simulated card form below.
  const stripeKey = config?.provider === 'stripe' ? config.publishableKey : null;
  const stripeActive = charge && !!stripeKey;
  const working = busy;

  const clearKeys = <T extends object>(patch: T) => Object.fromEntries(Object.keys(patch).map(k => [k, undefined]));
  const patchShip = (patch: Partial<AddressState>) => {
    setShip(s => ({...s, ...patch}));
    setSavedId('');
    setErrors(e => ({...e, shipping: {...e.shipping, ...clearKeys(patch)}}));
  };
  const patchBilling = (patch: Partial<AddressState>) => {
    setBilling(s => ({...s, ...patch}));
    setErrors(e => ({...e, billing: {...e.billing, ...clearKeys(patch)}}));
  };
  const patchCard = (patch: Partial<CardState>) => {
    setCard(c => ({...c, ...patch}));
    setErrors(e => ({...e, form: undefined, card: {...e.card, ...clearKeys(patch)}}));
  };

  const chooseSaved = (id: string) => {
    const a = addresses.find(x => x.id === id);
    if (!a) return;
    setShip(toAddressState(a));
    setSavedId(id);
    setErrors(e => ({...e, shipping: {}}));
  };

  const removeFailedCode = async () => {
    if (removingCode) return;
    setRemovingCode(true);
    try {
      const next = await removeDiscount();
      bag.applyCart(next);
      onCart(next);
      failedCode.current = null;
      setCodeError(null);
      setErrors(x => ({...x, form: undefined}));
    } catch (err) {
      setErrors(x => ({...x, form: errorMessage(err)}));
    } finally {
      setRemovingCode(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (working) return;
    const next: Errors = {shipping: {}, billing: {}, card: {}};
    if (!contactValid) next.email = t('errors.email');
    if (guestPhone && !phone.trim()) next.phone = t('errors.phone');
    if (!digitalOnly) {
      next.shipping = validateAddress(ship, t);
      if (!chosen) next.method = t('errors.method');
      if (!billingSame) next.billing = validateAddress(billing, t);
    }
    if (orderNotes && note.trim().length > NOTE_MAX) next.note = t('errors.noteLength', {max: NOTE_MAX});
    if (termsText && !acceptTerms) next.terms = t('errors.terms');
    if (charge && !stripeActive) {
      if (payment !== 'Card') next.form = t('errors.payByCard');
      else next.card = validateCard(card, t);
    }
    setEmailTouched(true);
    setSignInNeeded(false);
    setErrors(next);
    if (hasErrors(next)) {
      focusFirstInvalid();
      return;
    }

    const body: CheckoutRequest = {
      email: email.trim(),
      phone: phone.trim() || undefined,
      shippingAddress: digitalOnly ? null : toApiAddress(ship),
      shippingMethodId: digitalOnly ? null : (chosen?.id ?? null),
      billingSameAsShipping: digitalOnly ? true : billingSame,
      billingAddress: !digitalOnly && !billingSame ? toApiAddress(billing) : undefined,
      payment: stripeActive
        ? undefined
        : {name: card.name.trim(), number: card.number.replace(/\s/g, ''), expiry: card.expiry, cvc: card.cvc},
      saveAddress: !!user && !digitalOnly && !savedId,
      ...(orderNotes && note.trim() ? {customerNote: note.trim()} : {}),
      ...(termsText ? {acceptTerms} : {}),
      // Checkout refuses (409 total_changed) rather than charge a total the customer didn't see.
      expectedTotal: totals.total,
    };

    setBusy(true);
    let leaving = false;
    try {
      // Stripe: check the payment details before an order exists.
      if (stripeActive) {
        const problem = await stripeRef.current?.submit();
        if (problem !== null) {
          setErrors({...NO_ERRORS, form: problem ?? t('errors.paymentLoading')});
          return;
        }
      }

      placed.current = true;
      const {order, payment: pay} = await placeOrder(body);
      const toConfirmation = (o: Order) => {
        leaving = true;
        bag.setCount(0);
        navigate(`${confirmationLink(o.number, locale)}?email=${encodeURIComponent(o.email)}`, {history: 'replace'});
      };

      if (pay.provider === 'stripe') {
        const returnUrl = `${window.location.origin}${confirmationLink(order.number, locale)}?email=${encodeURIComponent(order.email)}`;
        const billingName = (!digitalOnly && !billingSame ? billing.name : ship.name).trim();
        const result = stripeRef.current
          ? await stripeRef.current.confirm(pay.clientSecret, returnUrl, {name: billingName, email: order.email, phone: phone.trim()})
          : {error: t('errors.paymentGone'), status: null};
        if (result.error) {
          // Release the order and put the pieces back in the bag, so another card can be tried.
          let released: Awaited<ReturnType<typeof cancelOrderPayment>> | null = null;
          try {
            released = await cancelOrderPayment(order.number, order.email);
          } catch {
            /* the expiry job releases it later */
          }
          if (released?.order?.payment === 'Paid') return toConfirmation(released.order);
          placed.current = false;
          void bag.sync(true);
          await refreshCart();
          setErrors({...NO_ERRORS, form: result.error});
          return;
        }
      }
      toConfirmation(order);
    } catch (err) {
      placed.current = false;
      if (isApiError(err) && isCustomerDiscountError(err.code)) {
        // The code stays on the bag; everything typed in the form stays as it is.
        setCodeError({code: err.code, message: err.message});
        setErrors({...NO_ERRORS, form: err.message});
        void refreshCart();
        return;
      }
      if (isApiError(err) && err.code.toLowerCase() === 'total_changed') {
        // Price for the email as typed now and show the new total; the customer confirms it by placing the order again.
        const v = email.trim().toLowerCase();
        if (EMAIL_RE.test(v)) setPricedEmail(v);
        void refreshCart();
        setErrors({...NO_ERRORS, form: err.message});
        return;
      }
      if (isApiError(err)) {
        if (err.status === 402) {
          setErrors({...NO_ERRORS, card: {number: err.message}, form: err.message});
          return;
        }
        if (err.code.toLowerCase() === 'sign_in_required') {
          setSignInNeeded(true);
          setErrors({...NO_ERRORS, form: err.message});
          return;
        }
        if (err.status === 409 || err.code.toLowerCase() === 'cart_empty' || err.status === 502) void refreshCart();
        if (err.fields && Object.keys(err.fields).length) {
          const mapped = mapApiFields(err.fields);
          setErrors({...mapped, form: mapped.form ?? err.message});
          focusFirstInvalid();
          return;
        }
      }
      setErrors({...NO_ERRORS, form: errorMessage(err)});
    } finally {
      // Navigating away keeps the button pending until the confirmation page replaces this one.
      if (!leaving) setBusy(false);
    }
  };

  const emailError = errors.email ?? (emailTouched && email && !contactValid ? t('errors.email') : undefined);
  const invalidCount = errorCount(errors);
  const returnDays = rules.returnWindowDays ?? 30;
  const signInHref = loginLink(checkoutLink(locale));

  return (
    <div className="mx-auto grid w-full max-w-page grid-cols-1 items-start lg:grid-cols-[minmax(0,1fr)_440px]">
      <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-10 px-6 py-10 md:p-12 lg:border-r lg:border-hairline">
        <h1 className="m-0 font-display text-[36px] leading-tight font-normal tracking-display md:text-display-3">{t('title')}</h1>

        <nav aria-label={t('steps.label')} className="flex flex-wrap items-center gap-5">
          {STEPS.map((label, i) => {
            const on = i <= activeStep;
            return (
              <span
                key={label}
                aria-current={i === activeStep ? 'step' : undefined}
                className={cn(LABEL, 'flex items-center gap-2.5', on ? 'text-text-primary' : 'text-text-muted')}>
                <span
                  className={cn(
                    'flex size-[22px] items-center justify-center border border-strong text-label-sm',
                    on ? 'bg-ink-900 text-ink-000' : 'bg-transparent text-ink-900'
                  )}>
                  {i + 1}
                </span>
                {t(`steps.${label}`)}
              </span>
            );
          })}
        </nav>

        <section aria-labelledby="ck-contact" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <h2 id="ck-contact" className={cn(LABEL_HEADING, 'text-text-muted')}>
              {t('contact')}
            </h2>
            {!user && (
              <p className="m-0 text-body-xs text-text-muted">
                {t('signInPrompt')}{' '}
                <a href={signInHref} className="text-text-primary underline underline-offset-4">
                  {t('signInLink')}
                </a>
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Input
              label={t('email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={254}
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setErrors(x => ({...x, email: undefined}));
              }}
              onBlur={() => {
                setEmailTouched(true);
                const v = email.trim().toLowerCase();
                if (EMAIL_RE.test(v)) setPricedEmail(v);
                // Remember the email for abandoned-bag reminders (best effort).
                if (EMAIL_RE.test(v) && v !== captured.current) {
                  captured.current = v;
                  captureCartEmail(v);
                }
              }}
              error={emailError}
            />
            <Input
              label={guestPhone ? t('phone') : t('phoneOptional')}
              aria-required={guestPhone || undefined}
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={phone}
              onChange={e => {
                setPhone(e.target.value);
                setErrors(x => ({...x, phone: undefined}));
              }}
              error={errors.phone}
            />
          </div>
        </section>

        {!digitalOnly && (
          <section aria-labelledby="ck-address" className="flex flex-col gap-5">
            <h2 id="ck-address" className={cn(LABEL_HEADING, 'text-text-muted')}>
              {t('shippingAddress')}
            </h2>
            {addresses.length > 1 && (
              <Select
                label={t('savedAddress')}
                value={savedId}
                placeholder={t('chooseSaved')}
                options={addresses.map(a => ({
                  value: a.id,
                  label: [a.label, a.line1, a.city].filter(Boolean).join(' · '),
                }))}
                onChange={e => chooseSaved(e.target.value)}
              />
            )}
            <AddressFields section="shipping" value={ship} onChange={patchShip} countries={countries} errors={errors.shipping} />
          </section>
        )}

        <section aria-labelledby="ck-ship" className="flex flex-col gap-4">
          <h2 id="ck-ship" className={cn(LABEL_HEADING, 'text-text-muted')}>
            {digitalOnly ? t('shippingMethod') : t('shippingMethodZone', {zone: zoneLabel ?? countryName(ship.country, locale)})}
          </h2>
          {digitalOnly ? (
            <p className="m-0 border border-hairline p-5 text-body-sm text-text-secondary">{t('digitalOnly')}</p>
          ) : methodsState.status === 'loading' || methodsState.status === 'idle' ? (
            <div className="flex items-center gap-3 border border-hairline px-5 py-[18px] text-body-sm text-text-muted">
              <Spinner size={14} /> {t('loadingMethods')}
            </div>
          ) : methodsState.status === 'error' ? (
            <p role="alert" className="m-0 text-body-xs text-signal-critical">
              {methodsState.error}
            </p>
          ) : (
            <div role="radiogroup" aria-labelledby="ck-ship" className="flex flex-col gap-4">
              {methods.map(x => {
                const checked = x.id === methodId;
                const rateLabel =
                  x.rate === 0 ? (totals.subtotal >= (totals.freeThreshold ?? Infinity) ? t('free') : m.money(0)) : m.money(x.rate);
                return (
                  <label
                    key={x.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-4 border px-5 py-[18px] transition-hover',
                      checked ? 'border-strong' : 'border-hairline hover:border-ink-400'
                    )}>
                    <input
                      type="radio"
                      name="ship"
                      value={x.id}
                      checked={checked}
                      aria-invalid={errors.method ? true : undefined}
                      onChange={() => {
                        setMethodId(x.id);
                        setErrors(v => ({...v, method: undefined}));
                      }}
                      className="m-0 size-3.5 accent-ink-900"
                    />
                    <span className="flex flex-1 flex-col gap-1">
                      <span className="text-[15px]">{x.name}</span>
                      <span className="text-body-xs text-text-muted">{x.detail}</span>
                    </span>
                    <span className="text-[15px]">{rateLabel}</span>
                  </label>
                );
              })}
              {errors.method && (
                <span role="alert" className="text-body-xs text-signal-critical">
                  {errors.method}
                </span>
              )}
            </div>
          )}
        </section>

        {charge && (
          <section aria-labelledby="ck-pay" className="flex flex-col gap-5">
            <h2 id="ck-pay" className={cn(LABEL_HEADING, 'text-text-muted')}>
              {t('payment')}
            </h2>
            {stripeActive && stripeKey ? (
              <Suspense
                fallback={
                  <div className="flex items-center gap-3 text-body-sm text-text-muted">
                    <Spinner size={14} /> {t('loadingSecure')}
                  </div>
                }>
                <StripePayment
                  publishableKey={stripeKey}
                  amount={totals.total}
                  currency={config?.currency ?? 'USD'}
                  handleRef={stripeRef}
                />
              </Suspense>
            ) : (
              <>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('paymentMethod')}>
                  {PAYMENTS.map(p => {
                    const on = payment === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setPayment(p);
                          setErrors(x => ({...x, form: undefined}));
                        }}
                        className={cn(
                          LABEL,
                          'border px-[18px] py-3 transition-hover',
                          on ? 'border-strong bg-ink-900 text-ink-000' : 'border-hairline bg-transparent text-ink-900 hover:border-strong'
                        )}>
                        {p === 'Card' ? t('methods.card') : p}
                      </button>
                    );
                  })}
                </div>
                {payment === 'Card' && (
                  <div className="grid grid-cols-2 gap-6 md:grid-cols-[2fr_1fr_1fr]">
                    <Input
                      label={t('card.name')}
                      autoComplete="cc-name"
                      maxLength={120}
                      value={card.name}
                      onChange={e => patchCard({name: e.target.value})}
                      error={errors.card.name}
                      className="col-span-2 md:col-span-3"
                    />
                    <Input
                      label={t('card.number')}
                      inputMode="numeric"
                      autoComplete="cc-number"
                      placeholder="4242 4242 4242 4242"
                      value={card.number}
                      onChange={e => patchCard({number: formatCardNumber(e.target.value)})}
                      error={errors.card.number}
                      className="col-span-2 md:col-span-1"
                    />
                    <Input
                      label={t('card.expiry')}
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      placeholder="09 / 29"
                      value={card.expiry}
                      onChange={e => patchCard({expiry: formatExpiry(e.target.value)})}
                      error={errors.card.expiry}
                    />
                    <Input
                      label={t('card.cvc')}
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      placeholder="123"
                      value={card.cvc}
                      onChange={e => patchCard({cvc: formatCvc(e.target.value)})}
                      error={errors.card.cvc}
                    />
                  </div>
                )}
              </>
            )}
            {!digitalOnly && (
              <Checkbox
                checked={billingSame}
                onChange={() => setBillingSame(v => !v)}
                label={<span className="text-body-sm text-text-secondary">{t('billingSame')}</span>}
              />
            )}
            {!digitalOnly && !billingSame && (
              <div className="flex flex-col gap-5 pt-2">
                <h3 className={cn(LABEL_HEADING, 'text-text-muted')}>{t('billingAddress')}</h3>
                <AddressFields section="billing" value={billing} onChange={patchBilling} countries={countries} errors={errors.billing} />
              </div>
            )}
          </section>
        )}

        {orderNotes && (
          <section aria-labelledby="ck-note" className="flex flex-col gap-5">
            <h2 id="ck-note" className={cn(LABEL_HEADING, 'text-text-muted')}>
              {t('note.title')}
            </h2>
            <Textarea
              aria-labelledby="ck-note"
              rows={3}
              value={note}
              maxLength={NOTE_MAX + 50}
              placeholder={t('note.placeholder')}
              onChange={e => {
                setNote(e.target.value);
                setErrors(x => ({...x, note: undefined}));
              }}
              hint={`${note.trim().length}/${NOTE_MAX}`}
              error={errors.note}
            />
          </section>
        )}

        <div className="flex flex-col items-start gap-4">
          {termsText && (
            <div className="flex flex-col gap-2">
              <Checkbox
                checked={acceptTerms}
                onChange={() => {
                  setAcceptTerms(v => !v);
                  setErrors(x => ({...x, terms: undefined}));
                }}
                label={<span className="text-body-sm whitespace-pre-line text-text-secondary">{termsText}</span>}
              />
              {errors.terms && (
                <span role="alert" className="text-body-xs text-signal-critical">
                  {errors.terms}
                </span>
              )}
            </div>
          )}
          {invalidCount > 0 && !errors.form && (
            <p role="alert" className="m-0 text-body-sm text-signal-critical">
              {t('errors.summary', {count: invalidCount})}
            </p>
          )}
          {errors.form && (
            <p
              role="alert"
              className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-2 border border-signal-critical px-4 py-3 text-body-sm text-signal-critical">
              <span>{errors.form}</span>
              {codeError && cart.discountCode && (
                <RemoveCodeButton
                  code={cart.discountCode}
                  disabled={removingCode}
                  className="text-body-xs text-text-primary"
                  onRemove={removeFailedCode}>
                  {t('removeCode')}
                </RemoveCodeButton>
              )}
              {signInNeeded && (
                <a href={signInHref} className="text-body-xs text-text-primary underline underline-offset-4">
                  {t('signIn.signIn')}
                </a>
              )}
            </p>
          )}
          <button
            type="submit"
            // Not disabled while totals refresh: leaving the email field refetches them, and the click that caused the
            // blur would land on a disabled button and do nothing. A total that moved meanwhile comes back as
            // 409 total_changed with the new amount (handled above).
            disabled={working}
            aria-busy={working || undefined}
            className={cn(
              LABEL,
              'inline-flex items-center gap-3 border-0 bg-ink-900 px-9 py-[18px] text-text-inverse transition-hover hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-48 max-sm:w-full max-sm:justify-center'
            )}>
            {working && <Spinner size={13} />}
            {working ? t('paying') : charge ? t('pay', {total: totalLabel}) : t('placeOrder')}
          </button>
          <p className="m-0 flex items-start gap-2 text-body-xs leading-body text-text-muted">
            <Icon name="lock" size={13} className="mt-[3px]" />
            <span>{t('trust', {count: returnDays})}</span>
          </p>
        </div>
      </form>

      <OrderSummary
        cart={cart}
        collapsible
        returnDays={returnDays}
        className="max-lg:order-first"
        totals={totals}
        methodLabel={methodLabel}
        discountContext={{
          country: ship.country || undefined,
          method: digitalOnly ? undefined : (chosen?.id ?? undefined),
          email: pricedEmail || undefined,
        }}
        codeError={codeError}
        onCart={onCart}
        onCodeRemoved={() => {
          failedCode.current = null;
          setCodeError(null);
          setErrors(x => ({...x, form: undefined}));
        }}
      />
    </div>
  );
}
