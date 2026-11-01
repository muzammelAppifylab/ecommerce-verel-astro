/* A Stripe payment that hasn't settled yet (port of `ConfirmingPayment` in VAREL src/pages/OrderConfirmation.tsx):
   ask the server (which asks Stripe) every 2 s for up to 30 s. Once the order leaves Pending, the page is rendered
   again on the server (Confirmed or Failed). "Check again" starts a new 30 s window. */
import {navigate} from 'astro:transitions/client';
import {useEffect, useState} from 'react';

import {Button, Container, Spinner} from '@/components/varel';
import {type Dicts, TextProvider, useLocale, useText} from '@/components/varel/text';
import {confirmationLink, shopLink} from '@/lib/links';
import {bag} from '@/lib/stores/bag';
import {isApiError} from '@/lib/storefront-api';
import {cn} from '@/lib/utils';

import {syncOrder} from './checkout-api';
import {LABEL, OUTLINE_CTA} from './ui';

export const POLL_MS = 2000;
export const POLL_FOR_MS = 30_000;

export interface ConfirmingPaymentProps {
  number: string;
  /** The order's email (shown in the "still confirming" copy) */
  orderEmail: string;
  /** The `?email=` the page was opened with (guests need it to read the order) */
  email?: string | null;
  locale: string;
  dicts: Dicts;
}

export default function ConfirmingPayment(props: ConfirmingPaymentProps) {
  return (
    <TextProvider locale={props.locale} dicts={props.dicts}>
      <Confirming {...props} />
    </TextProvider>
  );
}

function Confirming({number, orderEmail, email}: ConfirmingPaymentProps) {
  const t = useText('orders');
  const locale = useLocale();
  const [round, setRound] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    let live = true;
    let inFlight = false;
    const stopAt = Date.now() + POLL_FOR_MS;
    const timeout = setTimeout(() => live && setTimedOut(true), POLL_FOR_MS);
    const poll = async () => {
      if (!live || inFlight) return;
      if (Date.now() >= stopAt) return;
      inFlight = true;
      try {
        const {order} = await syncOrder(number, email ?? undefined);
        if (live && order.payment !== 'Pending') {
          live = false;
          void bag.sync(true);
          const q = email ? `?email=${encodeURIComponent(email)}` : '';
          navigate(`${confirmationLink(number, locale)}${q}`, {history: 'replace'});
        }
      } catch (err) {
        // The order is gone (or not this visitor's): stop and show the timed-out copy.
        if (live && isApiError(err) && err.status === 404) {
          live = false;
          setTimedOut(true);
        }
        // Other errors: try again on the next tick (the 30 s window still applies).
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [round, number, email, locale]);

  return (
    <Container className="flex min-h-[60vh] flex-col items-start justify-center gap-6 py-24">
      <span className={cn(LABEL, 'text-text-muted')}>{t('orderNumber', {number})}</span>
      <h1 className="m-0 font-display text-[40px] leading-tight font-normal tracking-display md:text-[54px]">
        {timedOut ? t('confirmation.stillConfirming') : t('confirmation.titleConfirming')}
      </h1>
      <p className="m-0 max-w-[52ch] text-body-md leading-body text-text-secondary" aria-live="polite">
        {timedOut ? t('confirmation.stillConfirmingBody', {email: orderEmail}) : t('confirmation.confirmingBody')}
      </p>
      {timedOut ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setRound(r => r + 1)}>
            {t('confirmation.checkAgain')}
          </Button>
          <a href={shopLink(locale)} className={cn(OUTLINE_CTA, 'px-6 py-[15px]')}>
            {t('continueShopping')}
          </a>
        </div>
      ) : (
        <span className="flex items-center gap-3 text-body-sm text-text-muted">
          <Spinner size={14} /> {t('confirmation.waiting')}
        </span>
      )}
    </Container>
  );
}
