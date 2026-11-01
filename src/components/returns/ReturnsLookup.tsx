/* Returns page island (VAREL src/pages/Returns.tsx header + ReturnRequest): the title, the order lookup form and the
   result below it. Server-rendered (the h1 is in the HTML), hydrated with `client:load`. The address bar
   (?order=&email=) drives the lookup: deep links from Order details and guest emails. */
import {type FormEvent, useEffect, useRef, useState} from 'react';

import {Spinner} from '@/components/varel';
import type {Dictionary} from '@/lib/i18n';
import {useT} from '@/lib/i18n/react';
import {href} from '@/lib/links';
import {errorMessage} from '@/lib/storefront-api';
import {cn} from '@/lib/utils';

import {GUTTER, ReturnRequest} from './ReturnRequest';
import {lookupReturn, ORDER_MAX, readReturnParams, type ReturnLookupResult} from './returns-api';

export const PAGE_TITLE = 'm-0 font-display text-[40px] font-normal leading-tight tracking-display md:text-[56px]';

interface Props {
  dict: Dictionary;
  locale: string;
  /** Setting.returnReasons (empty: a free-text reason) */
  returnReasons: string[];
  /** `?order=` read on the server, so the input is filled without a flash */
  initialOrder?: string;
}

interface Done {
  result: ReturnLookupResult;
  email?: string;
}

export function ReturnsLookup({dict, locale, returnReasons, initialOrder = ''}: Props) {
  const t = useT(dict, 'returns');
  const [order, setOrder] = useState(initialOrder);
  const [note, setNote] = useState<{text: string; critical: boolean} | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const lastKey = useRef<string | null>(null);
  const urlEmail = useRef<string>('');
  const urlOrder = useRef<string>('');
  const seq = useRef(0);

  const run = async (number: string, email?: string, scroll = true) => {
    lastKey.current = `${number}|${email ?? ''}`;
    setNote(null);
    setPending(true);
    const mine = ++seq.current;
    try {
      const result = await lookupReturn(number, email);
      if (mine !== seq.current) return;
      setDone({result, email});
      if (scroll) {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(() =>
          document.getElementById('return-title')?.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block: 'center'})
        );
      }
    } catch (err) {
      if (mine !== seq.current) return;
      setDone(null);
      setNote({text: errorMessage(err, t('lookup.notFound')), critical: true});
    } finally {
      if (mine === seq.current) setPending(false);
    }
  };

  // Deep links: ?order= (and ?email= from guest emails) run the lookup once on arrival.
  useEffect(() => {
    const {order: o, email} = readReturnParams(location.search);
    urlOrder.current = o;
    urlEmail.current = email;
    if (!o) return;
    const key = `${o}|${email}`;
    if (lastKey.current === key) return;
    setOrder(o);
    void run(o, email || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keep the address in step without adding history entries (Astro's ClientRouter owns history). */
  const replaceUrl = (search: string) => {
    history.replaceState(history.state, '', `${href('/returns/', locale)}${search}`);
  };

  const onLookup = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const number = order.trim();
    if (!number) {
      setNote({text: t('lookup.enterNumber'), critical: false});
      document.getElementById('ret-order')?.focus();
      return;
    }
    if (number.toLowerCase() === urlOrder.current.toLowerCase()) {
      // Same order as the URL: keep any email from the link and look it up again.
      void run(number, urlEmail.current || undefined);
      return;
    }
    // A different order: the email in the link belonged to the previous one, so drop it.
    urlOrder.current = number;
    urlEmail.current = '';
    replaceUrl(`?order=${encodeURIComponent(number)}`);
    void run(number);
  };

  const reset = () => {
    seq.current++;
    setPending(false);
    setDone(null);
    lastKey.current = null;
    urlOrder.current = '';
    urlEmail.current = '';
    setOrder('');
    setNote(null);
    replaceUrl('');
    requestAnimationFrame(() => document.getElementById('ret-order')?.focus());
  };

  const critical = !!note?.critical;
  return (
    <>
      <header
        className={cn(
          'grid grid-cols-1 items-end gap-10 border-b border-hairline pt-6 pb-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16',
          GUTTER
        )}>
        <div className="flex flex-col gap-4">
          <h1 className={PAGE_TITLE}>{t('title')}</h1>
          <p className="m-0 max-w-[52ch] text-body-md text-text-secondary">{t('intro')}</p>
        </div>
        <form noValidate onSubmit={onLookup} className="flex flex-col gap-2.5">
          <label htmlFor="ret-order" className="text-[11px] leading-snug tracking-label text-text-muted uppercase">
            {t('lookup.label')}
          </label>
          <div className={cn('flex gap-3 border-b', critical ? 'border-signal-critical' : 'border-strong')}>
            <input
              id="ret-order"
              type="text"
              value={order}
              maxLength={ORDER_MAX + 4}
              onChange={e => {
                setOrder(e.target.value);
                setNote(null);
              }}
              placeholder={t('lookup.placeholder')}
              autoComplete="off"
              aria-describedby="ret-order-note"
              aria-invalid={critical || undefined}
              className="min-w-0 flex-1 rounded-none border-0 bg-transparent py-3 text-body-md text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending || undefined}
              className="inline-flex items-center gap-2 border-0 bg-transparent text-[11px] leading-snug tracking-label uppercase transition-hover hover:text-ink-500 disabled:cursor-not-allowed disabled:opacity-60">
              {pending && <Spinner size={12} />}
              {pending ? t('lookup.pending') : t('lookup.button')}
            </button>
          </div>
          <span
            id="ret-order-note"
            role={critical ? 'alert' : undefined}
            className={cn('text-[12px]', critical ? 'text-signal-critical' : 'text-text-muted')}>
            {note?.text ?? t('lookup.note')}
          </span>
        </form>
      </header>

      {done && (
        <ReturnRequest
          key={done.result.order.number}
          result={done.result}
          email={done.email}
          reasons={returnReasons}
          locale={locale}
          t={t}
          onReset={reset}
        />
      )}
    </>
  );
}
