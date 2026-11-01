import {type FormEvent, useState} from 'react';

import {Button, Icon, Input} from '@/components/varel';
import {dotJoin, money} from '@/lib/format';
import type {TFunction} from '@/lib/i18n';
import {href} from '@/lib/links';
import {errorMessage, isApiError} from '@/lib/storefront-api';
import type {CreateReturnResponse} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {type LinePick, ReturnLine} from './ReturnLine';
import {createReturn, EMAIL_MAX, looksLikeEmail, type ReturnLookupResult} from './returns-api';

export const GUTTER = 'px-6 md:px-12';
export const META = 'text-[11px] leading-snug tracking-label uppercase text-text-muted';
export const OUTLINE_ACTION =
  'self-start border border-strong px-6 py-3.5 text-[11px] leading-snug tracking-label uppercase text-text-primary transition-hover hover:border-strong hover:bg-ink-900 hover:text-text-inverse';

const EMAIL_FIELD = 'ret-email';

/** Result of a returns lookup: either why the order cannot be returned, or the pieces to choose from
    (VAREL policy/ReturnRequest.tsx). */
export function ReturnRequest({
  result,
  email,
  reasons,
  locale,
  t,
  onReset,
}: {
  result: ReturnLookupResult;
  /** Email from the lookup (guest links), passed on to the return request */
  email?: string;
  reasons: string[];
  locale: string;
  /** `returns` namespace (`orders:` keys for statuses) */
  t: TFunction;
  onReset: () => void;
}) {
  const {order, eligible, reason, access} = result;
  // A number-only lookup shows a redacted order; booking needs the order's email.
  const needsEmail = access === 'number' && !email;
  const returnable = order.items.filter(i => !i.digital);
  const [picks, setPicks] = useState<Record<string, LinePick>>(() =>
    Object.fromEntries(returnable.map(i => [i.lineId, {on: returnable.length === 1, qty: i.qty, reason: ''}]))
  );
  const [typedEmail, setTypedEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<CreateReturnResponse | null>(null);

  const chosen = returnable.filter(i => picks[i.lineId]?.on);
  // Estimated: the price of the chosen pieces (discounts and tax are settled by the studio).
  const refund = chosen.reduce((sum, i) => sum + i.price * (picks[i.lineId]?.qty ?? 0), 0);

  const update = (lineId: string, patch: Partial<LinePick>) => {
    setPicks(p => ({...p, [lineId]: {...p[lineId]!, ...patch}}));
    setFieldErrors(e => {
      const next = {...e};
      delete next[lineId];
      return next;
    });
    setFormError(null);
  };

  const focusFirst = (ids: string[]) =>
    requestAnimationFrame(() => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.focus();
          return;
        }
      }
    });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setFormError(null);
    if (chosen.length === 0) {
      setFormError(t('request.chooseOne'));
      return;
    }
    const errors: Record<string, string> = {};
    for (const i of chosen) if (!picks[i.lineId]!.reason.trim()) errors[i.lineId] = t('request.whyOneLine');
    const sendEmail = needsEmail ? typedEmail.trim() : email;
    if (needsEmail && !looksLikeEmail(typedEmail)) errors[EMAIL_FIELD] = t('request.emailNeeded');
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      focusFirst([...chosen.filter(i => errors[i.lineId]).map(i => `ret-line-${i.lineId}-reason`), ...(errors[EMAIL_FIELD] ? [EMAIL_FIELD] : [])]);
      return;
    }
    const items = chosen.map(i => ({lineId: i.lineId, qty: picks[i.lineId]!.qty, reason: picks[i.lineId]!.reason.trim()}));
    setPending(true);
    try {
      setDone(await createReturn({order: order.number, email: sendEmail || undefined, items}));
    } catch (err) {
      if (isApiError(err) && err.fields) {
        // Fields come back as items.<index>.<field> (or email): map them onto the chosen lines.
        const mapped: Record<string, string> = {};
        for (const [key, msg] of Object.entries(err.fields)) {
          const m = /^items\.(\d+)\./.exec(key);
          const line = m ? items[Number(m[1])] : undefined;
          if (line) mapped[line.lineId] = msg;
          else if (key === 'email') mapped[EMAIL_FIELD] = msg;
        }
        setFieldErrors(mapped);
      }
      setFormError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const status = t(`orders:fulfillment.${order.fulfillment.toLowerCase()}`, {defaultValue: order.fulfillment});
  return (
    <section aria-labelledby="return-title" aria-live="polite" className={cn('border-b border-hairline py-12', GUTTER)}>
      <div className="flex flex-col gap-8 border border-hairline p-6 md:p-10">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex flex-col gap-2.5">
            <span className={META}>{dotJoin(t('request.order', {number: order.number}), order.date, status)}</span>
            <h2 id="return-title" className="m-0 font-display text-[28px] font-normal leading-[1.1] tracking-normal md:text-[32px]">
              {done ? t('request.booked') : eligible ? t('request.choose') : t('request.notYet')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={pending}
            className="border-0 border-b border-hairline bg-transparent p-0 pb-0.5 text-[11px] leading-snug tracking-label uppercase transition-hover hover:border-strong disabled:cursor-not-allowed disabled:opacity-48">
            {t('request.lookupAnother')}
          </button>
        </div>

        {done ? (
          <div className="flex flex-col gap-6">
            <div role="status" className="flex items-start gap-3 border border-signal-positive p-5 text-body-sm text-signal-positive">
              <Icon name="check" size={16} className="mt-1" />
              <span>{t('request.requested', {count: chosen.length, email: needsEmail ? typedEmail.trim() : order.email})}</span>
            </div>
            <p className="m-0 max-w-[62ch] text-body-md leading-[1.7] text-text-secondary">
              {order.carrier ? t('request.packCarrier', {carrier: order.carrier}) : t('request.pack')}
            </p>
            <span className={META}>{t('request.reference', {id: done.id})}</span>
          </div>
        ) : !eligible ? (
          <div className="flex flex-col gap-6">
            <p className="m-0 max-w-[62ch] text-body-md leading-[1.7] text-text-secondary">
              {t('request.notEligible', {reason: reason ?? t('request.notEligibleReason')})}
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={href('/contact/', locale)} className={OUTLINE_ACTION}>
                {t('writeStudio')}
              </a>
            </div>
          </div>
        ) : returnable.length === 0 ? (
          <p className="m-0 max-w-[62ch] text-body-md leading-[1.7] text-text-secondary">{t('request.allDigital')}</p>
        ) : (
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-8">
            <ul className="m-0 flex list-none flex-col border-t border-hairline p-0">
              {returnable.map(item => (
                <ReturnLine
                  key={item.lineId}
                  item={item}
                  pick={picks[item.lineId]!}
                  error={fieldErrors[item.lineId]}
                  currency={order.currency}
                  locale={locale}
                  reasons={reasons}
                  t={t}
                  onChange={patch => update(item.lineId, patch)}
                />
              ))}
            </ul>
            {needsEmail && (
              <Input
                id={EMAIL_FIELD}
                type="email"
                label={t('lookup.emailLabel')}
                hint={t('request.emailHint')}
                value={typedEmail}
                onChange={e => {
                  setTypedEmail(e.target.value);
                  setFieldErrors(f => {
                    const next = {...f};
                    delete next[EMAIL_FIELD];
                    return next;
                  });
                  setFormError(null);
                }}
                autoComplete="email"
                maxLength={EMAIL_MAX}
                error={fieldErrors[EMAIL_FIELD] ?? null}
                className="max-w-[420px]"
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex flex-col gap-1">
                <span className={META}>{t('request.estimatedRefund')}</span>
                <span className="font-display text-[26px] leading-[1.1]">{money(refund, order.currency, locale)}</span>
              </div>
              <Button type="submit" loading={pending} loadingLabel={t('request.submitting')} disabled={chosen.length === 0}>
                {t('request.submit')}
              </Button>
            </div>
            {formError && (
              <span role="alert" className="text-body-xs text-signal-critical">
                {formError}
              </span>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
