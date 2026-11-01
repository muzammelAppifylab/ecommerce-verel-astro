/* The payment failed, was cancelled or expired (port of `PaymentFailed` in VAREL src/pages/OrderConfirmation.tsx):
   nothing was charged; "Return to your bag" releases the order, puts its pieces back and opens the bag. */
import {navigate} from 'astro:transitions/client';
import {useState} from 'react';

import {Container, Spinner} from '@/components/varel';
import {type Dicts, TextProvider, useLocale, useText} from '@/components/varel/text';
import {cartLink, href} from '@/lib/links';
import {bag} from '@/lib/stores/bag';
import {errorMessage} from '@/lib/storefront-api';
import {cn} from '@/lib/utils';

import {cancelOrderPayment} from './checkout-api';
import {LABEL, OUTLINE_CTA, SOLID_CTA} from './ui';

export interface PaymentFailedProps {
  number: string;
  orderEmail: string;
  /** The `?email=` the page was opened with */
  email?: string | null;
  locale: string;
  dicts: Dicts;
}

export default function PaymentFailed(props: PaymentFailedProps) {
  return (
    <TextProvider locale={props.locale} dicts={props.dicts}>
      <Failed {...props} />
    </TextProvider>
  );
}

function Failed({number, orderEmail, email}: PaymentFailedProps) {
  const t = useText('orders');
  const locale = useLocale();
  const [restoring, setRestoring] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const backToBag = async () => {
    if (restoring) return;
    setRestoring(true);
    setProblem(null);
    try {
      await cancelOrderPayment(number, email ?? orderEmail);
      await bag.sync(true);
      navigate(cartLink(locale));
    } catch (err) {
      setProblem(errorMessage(err));
      setRestoring(false);
    }
  };

  return (
    <Container className="flex min-h-[60vh] flex-col items-start justify-center gap-6 py-24">
      <span className={cn(LABEL, 'text-signal-critical')}>{t('confirmation.titleFailed')}</span>
      <h1 className="m-0 font-display text-[40px] leading-tight font-normal tracking-display md:text-[54px]">
        {t('confirmation.failedTitle')}
      </h1>
      <p className="m-0 max-w-[52ch] text-body-md leading-body text-text-secondary">{t('confirmation.failedBody', {number})}</p>
      {problem && (
        <p role="alert" className="m-0 text-body-sm text-signal-critical">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-3 max-sm:w-full">
        <button
          type="button"
          onClick={backToBag}
          disabled={restoring}
          aria-busy={restoring || undefined}
          className={cn(
            SOLID_CTA,
            'inline-flex items-center justify-center gap-3 px-6 py-[15px] disabled:cursor-not-allowed disabled:opacity-48 max-sm:w-full'
          )}>
          {restoring && <Spinner size={13} />}
          {t('confirmation.returnToBag')}
        </button>
        <a href={href('/contact/', locale)} className={cn(OUTLINE_CTA, 'px-6 py-[15px] max-sm:w-full')}>
          {t('contactStudio')}
        </a>
      </div>
    </Container>
  );
}
