/* "Discount code" underlined field with Apply and inline notes, used on the bag page and at checkout (port of VAREL
   src/pages/checkout/DiscountForm.tsx). Applied codes are removed from their totals row; a stored code that is not
   applying explains why here. Mutations go through the bag store (./cart-store); words from the `checkout`
   namespace of the nearest <TextProvider>. AGENTS.md: the Apply button is pending while it runs ("Applying…"). */
import {useEffect, useState, type FormEvent, type ReactNode} from 'react';

import {Spinner} from '@/components/varel/Spinner';
import {notify} from '@/components/varel/Toast';
import {errorMessage, isApiError} from '@/lib/storefront-api';
import type {Cart, DiscountContext} from '@/lib/types/cart';
import {cn} from '@/lib/utils';

import {applyDiscount, removeDiscount} from './cart-store';
import {codeApplies, isDiscountError, NOTICE_DISCOUNT_ERRORS, RemoveCodeButton} from './discounts';
import {useCartText} from './text';
import {LABEL} from './ui';

export interface DiscountFormProps {
  cart: Pick<Cart, 'discountCode' | 'discountNote' | 'totals'> & {discountError?: Cart['discountError']};
  id: string;
  /** Checkout: the country, method and email the page is priced for, so the code is judged as checkout will */
  context?: DiscountContext;
  /** Checkout found the stored code no longer works for this customer (422 from POST /site-api/checkout) */
  checkoutError?: {code: string; message: string} | null;
  /** Called once the code is applied or removed (clears `checkoutError`) */
  onRemoved?: () => void;
  /** Checkout: a "Have a discount code?" link until opened (open whenever a code is on the bag) */
  collapsible?: boolean;
  className?: string;
}

type Tone = 'critical' | 'notice';
type Note = {text: string; tone: Tone} | null;

const TONE: Record<Tone, string> = {critical: 'text-signal-critical', notice: 'text-signal-notice'};

export function DiscountForm({cart, id, context, checkoutError, onRemoved, collapsible = false, className}: DiscountFormProps) {
  const t = useCartText('checkout');
  const tc = useCartText('cart');
  const [code, setCode] = useState(cart.discountCode ?? '');
  const [note, setNote] = useState<Note>(null);
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const busy = applying || removing;

  // Keep the field in step with the bag (a code removed from the totals row, another tab …).
  useEffect(() => {
    setCode(cart.discountCode ?? '');
  }, [cart.discountCode]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = code.trim();
    if (!value) {
      setNote({text: t('discount.enter'), tone: 'critical'});
      document.getElementById(id)?.focus();
      return;
    }
    const previous = cart.discountCode;
    setApplying(true);
    try {
      const next = await applyDiscount(value, context);
      const applied = next.discountCode ?? value.toUpperCase();
      setCode(applied);
      setNote(null);
      onRemoved?.();
      const replaced = !!previous && previous.toUpperCase() !== applied.toUpperCase();
      const working = codeApplies(next);
      const key = working ? (replaced ? 'appliedReplaces' : 'applied') : replaced ? 'savedReplaces' : 'saved';
      notify(t(`discount.${key}`, {code: applied, previous}));
    } catch (err) {
      const tone: Tone = isApiError(err) && isDiscountError(NOTICE_DISCOUNT_ERRORS, err.code) ? 'notice' : 'critical';
      setNote({text: errorMessage(err), tone});
    } finally {
      setApplying(false);
    }
  };

  const onRemove = async () => {
    if (busy) return;
    setRemoving(true);
    try {
      await removeDiscount();
      setCode('');
      setNote(null);
      onRemoved?.();
    } catch (err) {
      setNote({text: errorMessage(err), tone: 'critical'});
    } finally {
      setRemoving(false);
    }
  };

  const stored = cart.discountCode;
  const applies = codeApplies(cart);
  const pending = stored && !applies ? cart.discountError : null;

  let body: ReactNode = null;
  if (note) {
    body = <span className={TONE[note.tone]}>{note.text}</span>;
  } else if (stored && checkoutError) {
    body = (
      <>
        <span className="text-signal-critical">{checkoutError.message}</span>
        <RemoveCodeButton code={stored} onRemove={onRemove} disabled={applying} pending={removing} className="text-text-primary">
          {t('removeCode')}
        </RemoveCodeButton>
      </>
    );
  } else if (stored && applies) {
    body = <span className="text-ink-400">{t('discount.statusApplied', {code: stored})}</span>;
  } else if (stored) {
    body = (
      <>
        <span className="text-ink-400">{t('discount.statusSaved', {code: stored})}</span>
        <RemoveCodeButton code={stored} onRemove={onRemove} disabled={applying} pending={removing} />
        {pending && <span className="basis-full text-signal-notice">{pending.message}</span>}
      </>
    );
  }

  const invalid = note?.tone === 'critical' || (!note && !!stored && !!checkoutError);

  if (collapsible && !expanded && !stored && !note) {
    return (
      <div className={className}>
        <button
          type="button"
          aria-expanded={false}
          aria-controls={id}
          onClick={() => {
            setExpanded(true);
            requestAnimationFrame(() => document.getElementById(id)?.focus());
          }}
          className="border-0 border-b border-strong bg-transparent p-0 pb-0.5 text-body-sm text-text-primary transition-hover hover:text-ink-500">
          {t('discount.toggle')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={cn('flex flex-col gap-2.5', className)} noValidate>
      <label htmlFor={id} className={cn(LABEL, 'text-text-muted')}>
        {t('discount.label')}
      </label>
      <div className={cn('flex gap-2.5 border-b', invalid ? 'border-signal-critical' : 'border-strong')}>
        <input
          id={id}
          name="code"
          type="text"
          value={code}
          maxLength={40}
          onChange={e => {
            setCode(e.target.value);
            setNote(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-note`}
          className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-body-sm text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          aria-busy={applying || undefined}
          className={cn(
            LABEL,
            'inline-flex items-center gap-2 border-0 bg-transparent px-0.5 text-text-primary transition-hover hover:text-ink-500 disabled:cursor-not-allowed disabled:opacity-48'
          )}>
          {applying && <Spinner size={12} />}
          {applying ? tc('applying') : t('discount.apply')}
        </button>
      </div>
      <span
        id={`${id}-note`}
        role={invalid ? 'alert' : 'status'}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] leading-snug">
        {body}
      </span>
    </form>
  );
}
